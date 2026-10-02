import Mathlib.Analysis.Calculus.Deriv.Pow
import Mathlib.Analysis.Calculus.Deriv.Mul
import Mathlib.Analysis.Calculus.Deriv.Add

/-!
# SIFT, step 7: refining the orientation peak

Claims checked here (Keypoint Detector Math, SIFT, "Orientation"):

* the peak of the parabola through three neighbouring histogram bins sits at offset
  `½(l − r)/(l − 2c + r)` from the center bin;
* when the center bin is a strict local maximum (OpenCV's condition), that offset is the
  parabola's maximum, and it lies strictly within half a bin of the center;
* scaling the histogram by any `a ≠ 0` does not move the offset (`peakOffset_mul`).

## The code being checked

OpenCV 4.12, `modules/features2d/src/sift.simd.hpp`, `findScaleSpaceExtrema`:

```cpp
if( hist[j] > hist[l]  &&  hist[j] > hist[r2]  &&  hist[j] >= mag_thr )
{
    float bin = j + 0.5f * (hist[l]-hist[r2]) / (hist[l] - 2*hist[j] + hist[r2]);
```

Here `l`, `c`, `r` stand for `hist[l]`, `hist[j]`, `hist[r2]`: the left neighbour, the center bin
and the right neighbour. The offset `t` is measured in bins from the center.

Not modeled:

* how `hist` is built: each gradient adds its magnitude, times a Gaussian weight with
  σ = 1.5 · scale, to bin `cvRound(θ · 36/360)`, over a window of radius `cvRound(4.5 · scale)`;
* the circular `[1 4 6 4 1]/16` smoothing applied before the peak search;
* the peak rule itself: each bin with `hist[j]` above both neighbours and
  `hist[j] ≥ 0.8 · max` adds a keypoint, at angle `360° − 10° · (j + t*)`. So a top bin that ties
  a neighbour adds no keypoint.
-/

namespace KeypointMath.SIFT

/-- The parabola through `(−1, l)`, `(0, c)` and `(1, r)`. -/
noncomputable def parabola (l c r t : ℝ) : ℝ :=
  c + (r - l) / 2 * t + (l - 2 * c + r) / 2 * t ^ 2

/-- It passes through the three bins. -/
theorem parabola_interpolates (l c r : ℝ) :
    parabola l c r (-1) = l ∧ parabola l c r 0 = c ∧ parabola l c r 1 = r := by
  refine ⟨?_, ?_, ?_⟩ <;> · unfold parabola; ring

/-- OpenCV's sub-bin offset, `0.5·(l − r)/(l − 2c + r)`. -/
noncomputable def peakOffset (l c r : ℝ) : ℝ := 0.5 * (l - r) / (l - 2 * c + r)

/-- At a strict local maximum the parabola opens downward: `l − 2c + r < 0`. -/
theorem curvature_neg {l c r : ℝ} (hl : l < c) (hr : r < c) : l - 2 * c + r < 0 := by
  linarith

/-- The defining property of OpenCV's offset: `(l − 2c + r) · t* = ½(l − r)`. -/
theorem curvature_mul_peakOffset {l c r : ℝ} (hd : l - 2 * c + r ≠ 0) :
    (l - 2 * c + r) * peakOffset l c r = 0.5 * (l - r) := by
  -- `mul_div_cancel₀`: `b · (a / b) = a` for `b ≠ 0`.
  unfold peakOffset
  exact mul_div_cancel₀ _ hd

/-- **Vertex form.** `p(t) = p(t*) + ½(l − 2c + r)(t − t*)²`, where `t*` is OpenCV's offset. -/
theorem parabola_vertex_form {l c r : ℝ} (hd : l - 2 * c + r ≠ 0) (t : ℝ) :
    parabola l c r t =
      parabola l c r (peakOffset l c r) + (l - 2 * c + r) / 2 * (t - peakOffset l c r) ^ 2 := by
  -- The difference of the two sides is `(t − t*) · ((l − 2c + r) t* − ½(l − r))`, which is 0;
  -- `linear_combination` checks that with `ring`.
  unfold parabola
  linear_combination (t - peakOffset l c r) * curvature_mul_peakOffset hd

/-- **OpenCV's offset is the parabola's maximum** when the center bin is a strict local maximum. -/
theorem parabola_le_peak {l c r : ℝ} (hl : l < c) (hr : r < c) (t : ℝ) :
    parabola l c r t ≤ parabola l c r (peakOffset l c r) := by
  rw [parabola_vertex_form (curvature_neg hl hr).ne t]
  -- A non-positive coefficient times a square is `≤ 0` (`mul_nonpos_of_nonpos_of_nonneg`).
  have h : (l - 2 * c + r) / 2 * (t - peakOffset l c r) ^ 2 ≤ 0 :=
    mul_nonpos_of_nonpos_of_nonneg (by linarith) (sq_nonneg _)
  linarith

/-- The parabola's slope is zero at OpenCV's offset. -/
theorem hasDerivAt_parabola_peak {l c r : ℝ} (hl : l < c) (hr : r < c) :
    HasDerivAt (parabola l c r) 0 (peakOffset l c r) := by
  have hd := (curvature_neg hl hr).ne
  -- Derivative of `c + a t + b t²` is `a + 2bt`: `hasDerivAt_mul_const`, `hasDerivAt_pow`,
  -- assembled with `.const_add` and `.fun_add`.
  have h1 : HasDerivAt (fun t : ℝ => t * ((r - l) / 2)) ((r - l) / 2) (peakOffset l c r) :=
    hasDerivAt_mul_const _
  have h2 := (hasDerivAt_pow 2 (peakOffset l c r)).mul_const ((l - 2 * c + r) / 2)
  have h := (h1.const_add c).fun_add h2
  have hfun : parabola l c r = fun t => c + t * ((r - l) / 2) + t ^ 2 * ((l - 2 * c + r) / 2) := by
    funext t
    unfold parabola
    ring
  rw [hfun]
  convert h using 1
  -- `norm_num` turns `((2 : ℕ) : ℝ) * t* ^ (2 - 1)` into `2 * t*`; the slope
  -- `(r − l)/2 + (l − 2c + r) t*` is then 0 by `curvature_mul_peakOffset`.
  norm_num
  linear_combination -curvature_mul_peakOffset hd

/-- **The refined peak stays within half a bin of the center bin**:
`|t*| < ½` whenever `l < c` and `r < c`. -/
theorem abs_peakOffset_lt {l c r : ℝ} (hl : l < c) (hr : r < c) : |peakOffset l c r| < 1 / 2 := by
  have hd := curvature_neg hl hr
  unfold peakOffset
  -- `abs_lt`: `|x| < a ↔ −a < x ∧ x < a`. Dividing by a negative number flips each inequality:
  -- `lt_div_iff_of_neg` and `div_lt_iff_of_neg`.
  rw [abs_lt, lt_div_iff_of_neg hd, div_lt_iff_of_neg hd]
  constructor <;> linarith

/-- **Scaling the histogram by `a ≠ 0` does not move the refined peak.** So a brightness gain
on the image, which scales every gradient magnitude, leaves the orientation offset unchanged. -/
theorem peakOffset_mul {a : ℝ} (ha : a ≠ 0) (l c r : ℝ) :
    peakOffset (a * l) (a * c) (a * r) = peakOffset l c r := by
  unfold peakOffset
  -- Factor `a` out of the numerator and the denominator, then cancel it (`mul_div_mul_left`).
  rw [show (0.5 : ℝ) * (a * l - a * r) = a * (0.5 * (l - r)) by ring,
    show a * l - 2 * (a * c) + a * r = a * (l - 2 * c + r) by ring, mul_div_mul_left _ _ ha]

/-- An example: bins `(4, 10, 7)` give the offset `+1/6` bin, toward the larger neighbour. -/
example : peakOffset 4 10 7 = 1 / 6 := by
  unfold peakOffset
  norm_num

end KeypointMath.SIFT
