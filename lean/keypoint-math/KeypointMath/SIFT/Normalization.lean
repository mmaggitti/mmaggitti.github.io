import Mathlib.Analysis.Real.Sqrt
import Mathlib.Analysis.SpecialFunctions.Complex.Arg
import Mathlib.Algebra.Order.BigOperators.Ring.Finset
import KeypointMath.SIFT.Constants

/-!
# SIFT, step 9: normalizing the descriptor

Claims checked here (Keypoint Detector Math, SIFT, "Normalization"):

* scaling to unit length gives length 1, and a positive rescaling of the histogram does not
  change the result;
* so, at a fixed keypoint, the descriptor is unchanged when the image `I` becomes `a·I + b` with
  `a > 0`: the offset `b` cancels in the gradients, and the gain `a` scales every magnitude
  without turning any angle;
* OpenCV clips the raw histogram at `0.2·‖v‖`, which is the same as Lowe's "normalize, clip at
  0.2, normalize again";
* what clipping guarantees: the output still has length 1, entries keep their order, and the
  ratio between two entries can only shrink. Entries are **not** capped at 0.2 in the output:
  the second normalization can scale them back up (`siftNormalize_single`).

The clip level is a parameter `t`. OpenCV uses `t = SIFT_DESCR_MAG_THR = 0.2`; the theorems hold
for every `t > 0`.

OpenCV adds a second cap when it stores the result. It writes `round(512 · uᵢ)`, capped at 255,
for both `CV_8U` and `CV_32F` output. So each stored entry is at most `255/512 ≈ 0.498` of the
unit vector. The single-bin descriptor of `siftNormalize_single` is stored as 255, not 512. The
same happens to any descriptor whose weight sits in four or fewer equal bins (`512/√4 = 256`).

## The code being checked

OpenCV 4.12, `modules/features2d/src/sift.simd.hpp`, `calcSIFTDescriptor`:

```cpp
float dx = (float)(img.at<sift_wt>(r, c+1) - img.at<sift_wt>(r, c-1));
float dy = (float)(img.at<sift_wt>(r-1, c) - img.at<sift_wt>(r+1, c));
...
for( ; k < len_ddn; k++ ) nrm2 += rawDst[k]*rawDst[k];
const float thr = std::sqrt(nrm2)*SIFT_DESCR_MAG_THR;        // 0.2·‖v‖
for( ; i < len_ddn; i++ ) {
    float val = std::min(rawDst[i], thr);
    rawDst[i] = val;
    nrm2 += val*val;
}
nrm2 = SIFT_INT_DESCR_FCTR/std::max(std::sqrt(nrm2), FLT_EPSILON);   // 512/‖clipped‖
dst[k] = saturate_cast<uchar>(rawDst[k]*nrm2);
```

Not modeled: the final `× 512`, the rounding and the cap at 255 (`saturate_cast<uchar>`), the
`FLT_EPSILON` guard, `float` arithmetic, and `fastAtan2`, which OpenCV uses as an approximate
`atan2`. The theorems are about the exact real-valued unit vector before those steps.

## Notation

* Descriptors are vectors `ι → ℝ` for any finite index type `ι` (OpenCV: 128 entries).
* `l2norm v = √(Σ vᵢ²)`.
* A gradient is the complex number `dx + i·dy`; its magnitude is `‖·‖` and its angle is
  `Complex.arg`, Mathlib's exact `atan2`.
-/

namespace KeypointMath.SIFT

open Finset

variable {ι : Type*} [Fintype ι]

/-- Euclidean length, `‖v‖ = √(Σ vᵢ²)`. -/
noncomputable def l2norm (v : ι → ℝ) : ℝ := Real.sqrt (∑ i, v i ^ 2)

/-- Scale to unit length. The zero vector stays zero (Lean's `0⁻¹ = 0`). -/
noncomputable def normalize (v : ι → ℝ) : ι → ℝ := (l2norm v)⁻¹ • v

theorem l2norm_nonneg (v : ι → ℝ) : 0 ≤ l2norm v := Real.sqrt_nonneg _

/-- `‖v‖ = 0` only for the zero vector. -/
theorem l2norm_eq_zero {v : ι → ℝ} : l2norm v = 0 ↔ v = 0 := by
  -- `Real.sqrt_eq_zero`: `√x = 0 ↔ x = 0` for `x ≥ 0`;
  -- `Finset.sum_sq_eq_zero_iff`: a sum of squares is 0 only if every term is.
  rw [l2norm, Real.sqrt_eq_zero (sum_nonneg fun i _ => sq_nonneg (v i)), sum_sq_eq_zero_iff]
  simp [funext_iff]

theorem l2norm_pos {v : ι → ℝ} (hv : v ≠ 0) : 0 < l2norm v :=
  lt_of_le_of_ne (l2norm_nonneg v) (Ne.symm (mt l2norm_eq_zero.mp hv))

/-- `‖a·v‖ = |a|·‖v‖`. -/
theorem l2norm_smul (a : ℝ) (v : ι → ℝ) : l2norm (a • v) = |a| * l2norm v := by
  have hsum : ∑ i, (a • v) i ^ 2 = a ^ 2 * ∑ i, v i ^ 2 := by
    rw [mul_sum]
    congr 1
    funext i
    simp [mul_pow]
  -- `Real.sqrt_mul`: `√(x·y) = √x·√y` for `x ≥ 0`; `Real.sqrt_sq_eq_abs`: `√(a²) = |a|`.
  rw [l2norm, l2norm, hsum, Real.sqrt_mul (sq_nonneg a), Real.sqrt_sq_eq_abs]

/-- **Normalizing gives length 1** (for a nonzero vector). -/
theorem l2norm_normalize {v : ι → ℝ} (hv : v ≠ 0) : l2norm (normalize v) = 1 := by
  rw [normalize, l2norm_smul, abs_inv, abs_of_pos (l2norm_pos hv),
    inv_mul_cancel₀ (l2norm_pos hv).ne']

theorem normalize_ne_zero {v : ι → ℝ} (hv : v ≠ 0) : normalize v ≠ 0 := by
  intro h
  have := l2norm_normalize hv
  rw [h, l2norm_eq_zero.mpr rfl] at this
  exact zero_ne_one this

/-- **A positive rescaling does not change the normalized vector:** `normalize (a·v) = normalize v`
for `a > 0`. -/
theorem normalize_smul {a : ℝ} (ha : 0 < a) (v : ι → ℝ) : normalize (a • v) = normalize v := by
  rw [normalize, normalize, l2norm_smul, abs_of_pos ha, smul_smul]
  congr 1
  -- `(a‖v‖)⁻¹ · a = ‖v‖⁻¹` (`mul_inv`, then cancel `a⁻¹ a`); also right when `‖v‖ = 0`.
  rw [mul_inv, mul_comm a⁻¹, mul_assoc, inv_mul_cancel₀ ha.ne', mul_one]

/-- `‖v‖ · normalize v = v` for a nonzero vector. -/
theorem smul_normalize {v : ι → ℝ} (hv : v ≠ 0) : l2norm v • normalize v = v := by
  rw [normalize, smul_smul, mul_inv_cancel₀ (l2norm_pos hv).ne', one_smul]

/-! ### Clipping -/

/-- Clip every entry at `t`: `min(vᵢ, t)`, as `std::min(rawDst[i], thr)` does. -/
def clip (t : ℝ) (v : ι → ℝ) : ι → ℝ := fun i => min (v i) t

omit [Fintype ι] in
/-- Clipping commutes with a nonnegative rescaling: `clip (N·t) (N·w) = N · clip t w`. -/
theorem clip_smul {N : ℝ} (hN : 0 ≤ N) (t : ℝ) (w : ι → ℝ) :
    clip (N * t) (N • w) = N • clip t w := by
  funext i
  simp only [clip, Pi.smul_apply, smul_eq_mul]
  -- `mul_min_of_nonneg`: `a · min b c = min (a·b) (a·c)` for `a ≥ 0`.
  exact (mul_min_of_nonneg _ _ hN).symm

omit [Fintype ι] in
/-- With a positive cap `t`, clipping sends only the zero vector to zero. -/
theorem clip_eq_zero_iff {t : ℝ} (ht : 0 < t) {w : ι → ℝ} : clip t w = 0 ↔ w = 0 := by
  constructor
  · intro h
    funext i
    have hi := congrFun h i
    simp only [clip, Pi.zero_apply] at hi ⊢
    -- `min (w i) t = 0` with `t > 0` forces `w i = 0`.
    rcases le_total (w i) t with hle | hle
    · rwa [min_eq_left hle] at hi
    · rw [min_eq_right hle] at hi
      linarith
  · rintro rfl
    funext i
    simp [clip, ht.le]

/-- Lowe's descriptor normalization with clip level `t`: normalize, clip at `t`, normalize
again. SIFT uses `t = 0.2`. -/
noncomputable def siftNormalize (t : ℝ) (v : ι → ℝ) : ι → ℝ := normalize (clip t (normalize v))

/-- OpenCV's version: clip the raw histogram at `‖v‖·t`, then normalize. This is the real-valued
vector before OpenCV's `× 512`, rounding and cap at 255. -/
noncomputable def opencvNormalize (t : ℝ) (v : ι → ℝ) : ι → ℝ :=
  normalize (clip (l2norm v * t) v)

/-- **OpenCV's single clip at `t·‖v‖` is Lowe's normalize–clip–normalize.** -/
theorem opencvNormalize_eq_siftNormalize {t : ℝ} (ht : 0 < t) (v : ι → ℝ) :
    opencvNormalize t v = siftNormalize t v := by
  by_cases hv : v = 0
  · -- Both sides are the zero vector.
    subst hv
    have h0 : clip t (0 : ι → ℝ) = 0 := (clip_eq_zero_iff ht).mpr rfl
    have h1 : clip (l2norm (0 : ι → ℝ) * t) (0 : ι → ℝ) = 0 := by
      funext i
      simp [clip, l2norm]
    simp [opencvNormalize, siftNormalize, normalize, h0, h1]
  · -- `v = ‖v‖ · normalize v`, so the cap `‖v‖·t` is the cap `t` scaled by `‖v‖`,
    -- and the scale `‖v‖ > 0` drops out of the final normalization.
    have key : clip (l2norm v * t) v = l2norm v • clip t (normalize v) := by
      rw [← clip_smul (l2norm_nonneg v), smul_normalize hv]
    rw [opencvNormalize, key, normalize_smul (l2norm_pos hv), siftNormalize]

/-- **The output has length 1** for any nonzero histogram. -/
theorem l2norm_siftNormalize {t : ℝ} (ht : 0 < t) {v : ι → ℝ} (hv : v ≠ 0) :
    l2norm (siftNormalize t v) = 1 :=
  l2norm_normalize (mt (clip_eq_zero_iff ht).mp (normalize_ne_zero hv))

/-- **A positive rescaling of the histogram does not change the descriptor.** -/
theorem siftNormalize_smul (t : ℝ) {a : ℝ} (ha : 0 < a) (v : ι → ℝ) :
    siftNormalize t (a • v) = siftNormalize t v := by
  rw [siftNormalize, siftNormalize, normalize_smul ha]

/-- **Clipping keeps the order of entries and can only shrink the ratio between two of them.**
For histogram entries `0 < vⱼ ≤ vᵢ`, the output satisfies `uⱼ ≤ uᵢ` and `uᵢ/uⱼ ≤ vᵢ/vⱼ`, the
second written without division as `uᵢ · vⱼ ≤ uⱼ · vᵢ`. -/
theorem siftNormalize_order_ratio {t : ℝ} (ht : 0 < t) {v : ι → ℝ} {i j : ι} (hj : 0 < v j)
    (hji : v j ≤ v i) :
    siftNormalize t v j ≤ siftNormalize t v i ∧
      siftNormalize t v i * v j ≤ siftNormalize t v j * v i := by
  have hv : v ≠ 0 := fun h => by simp [h] at hj
  -- `N = ‖v‖ > 0`, `x = v/N` (first normalization), `M = ‖clip t x‖ > 0`.
  set N := l2norm v with hNdef
  have hN : 0 < N := l2norm_pos hv
  have hc : clip t (normalize v) ≠ 0 :=
    mt (clip_eq_zero_iff ht).mp (normalize_ne_zero hv)
  set M := l2norm (clip t (normalize v)) with hMdef
  have hM : 0 < M := l2norm_pos hc
  -- Each output entry is `M⁻¹ · min (N⁻¹ vₖ) t`.
  have hu : ∀ k, siftNormalize t v k = M⁻¹ * min (N⁻¹ * v k) t := fun k => by
    simp [siftNormalize, normalize, clip, hMdef, hNdef]
  rw [hu i, hu j]
  have hMi : 0 < M⁻¹ := inv_pos.mpr hM
  have hNi : 0 < N⁻¹ := inv_pos.mpr hN
  set xi := N⁻¹ * v i
  set xj := N⁻¹ * v j
  have hxj : 0 < xj := mul_pos hNi hj
  have hxji : xj ≤ xi := mul_le_mul_of_nonneg_left hji hNi.le
  constructor
  · -- `min` is monotone (`min_le_min_right`), and `M⁻¹ > 0` keeps the order.
    exact mul_le_mul_of_nonneg_left (min_le_min_right _ hxji) hMi.le
  · -- `min(xᵢ, t)·vⱼ ≤ min(xⱼ, t)·vᵢ`, case by case on which entries were clipped.
    have hcore : min xi t * v j ≤ min xj t * v i := by
      rcases le_total xi t with hi | hi
      · -- Neither clipped: both sides equal `N⁻¹ vᵢ vⱼ`.
        rw [min_eq_left hi, min_eq_left (hxji.trans hi)]
        exact le_of_eq (by simp only [xi, xj]; ring)
      · rcases le_total xj t with hj' | hj'
        · -- Only `vᵢ` clipped: `t vⱼ ≤ xᵢ vⱼ = xⱼ vᵢ`, since `t ≤ xᵢ`.
          rw [min_eq_right hi, min_eq_left hj']
          have h1 : t * v j ≤ xi * v j := mul_le_mul_of_nonneg_right hi hj.le
          have h2 : xi * v j = xj * v i := by simp only [xi, xj]; ring
          linarith
        · -- Both clipped: `t vⱼ ≤ t vᵢ`.
          rw [min_eq_right hi, min_eq_right hj']
          exact mul_le_mul_of_nonneg_left hji ht.le
    calc M⁻¹ * min xi t * v j = M⁻¹ * (min xi t * v j) := by ring
      _ ≤ M⁻¹ * (min xj t * v i) := mul_le_mul_of_nonneg_left hcore hMi.le
      _ = M⁻¹ * min xj t * v i := by ring

/-- `‖Pi.single i a‖ = |a|`: a vector with one nonzero entry. -/
theorem l2norm_single [DecidableEq ι] (i : ι) (a : ℝ) : l2norm (Pi.single i a) = |a| := by
  have : ∑ k, (Pi.single i a : ι → ℝ) k ^ 2 = a ^ 2 := by
    rw [Finset.sum_eq_single i]
    · simp
    · intro k _ hk
      simp [hk]
    · simp
  rw [l2norm, this, Real.sqrt_sq_eq_abs]

/-- **Entries are not capped at `t` in the output.** With all the weight in one bin, clipping
cuts that bin to `min(1, t)`, and the second normalization scales it back to 1. -/
theorem siftNormalize_single [DecidableEq ι] {t : ℝ} (ht : 0 < t) (i : ι) :
    siftNormalize t (Pi.single i (1 : ℝ)) = Pi.single i 1 := by
  -- First normalization: the vector already has length 1.
  have h1 : normalize (Pi.single i (1 : ℝ)) = Pi.single i 1 := by
    rw [normalize, l2norm_single]
    simp
  -- Clipping: `min 1 t` in bin `i`, `min 0 t = 0` elsewhere.
  -- `lt_min`: `a < b → a < c → a < min b c`.
  have hm : 0 < min 1 t := lt_min one_pos ht
  have h2 : clip t (Pi.single i (1 : ℝ)) = Pi.single i (min 1 t) := by
    funext k
    by_cases hk : k = i
    · subst hk
      simp [clip]
    · simp [clip, hk, ht.le]
  -- Second normalization: `(min 1 t)⁻¹ · min 1 t = 1` in bin `i`.
  rw [siftNormalize, h1, h2, normalize, l2norm_single, abs_of_pos hm]
  funext k
  by_cases hk : k = i
  · subst hk
    simp [hm.ne']
  · simp [hk]

open OpenCV in
/-- With OpenCV's clip level and 128 bins, the single-bin descriptor's entry is 1, not 0.2. -/
example :
    siftNormalize SIFT_DESCR_MAG_THR (Pi.single (0 : Fin 128) (1 : ℝ)) 0 = 1 ∧
      SIFT_DESCR_MAG_THR < 1 := by
  rw [siftNormalize_single (by norm_num [SIFT_DESCR_MAG_THR])]
  norm_num [SIFT_DESCR_MAG_THR]

/-! ### Invariance to brightness and contrast: `I ↦ a·I + b` -/

/-- OpenCV's gradient at pixel `p = (x, y)`, as the complex number `dx + i·dy` with
`dx = I(x+1, y) − I(x−1, y)` and `dy = I(x, y−1) − I(x, y+1)` (rows grow downward). -/
def gradAt (I : ℤ × ℤ → ℝ) (p : ℤ × ℤ) : ℂ :=
  ⟨I (p.1 + 1, p.2) - I (p.1 - 1, p.2), I (p.1, p.2 - 1) - I (p.1, p.2 + 1)⟩

/-- **The gradient of `a·I + b` is `a` times the gradient of `I`:** the offset `b` cancels in
each difference. -/
theorem gradAt_affine (a b : ℝ) (I : ℤ × ℤ → ℝ) (p : ℤ × ℤ) :
    gradAt (fun q => a * I q + b) p = (a : ℂ) * gradAt I p := by
  apply Complex.ext <;> simp [gradAt] <;> ring

/-- The raw (unnormalized) descriptor histogram at a fixed keypoint. Each sample `s`, at pixel
`pos s`, adds `w b s θ · m` to bin `b`, where `m = ‖∇I‖` and `θ = arg ∇I`. The weight `w` stands
for everything else OpenCV multiplies in: the Gaussian window, the trilinear split, and the turn
by the keypoint's angle. It may depend on the bin, the sample and the gradient angle, but not on
pixel values. That holds because the keypoint (position, scale and orientation) is held fixed.
`I` is the blurred pyramid layer that OpenCV samples. -/
noncomputable def rawHist {S B : Type*} [Fintype S] (pos : S → ℤ × ℤ) (w : B → S → ℝ → ℝ)
    (I : ℤ × ℤ → ℝ) : B → ℝ :=
  fun b => ∑ s, w b s (Complex.arg (gradAt I (pos s))) * ‖gradAt I (pos s)‖

/-- Under `I ↦ a·I + b` with `a > 0`, every angle stays put (`Complex.arg_real_mul`) and every
magnitude is multiplied by `a`, so the raw histogram is multiplied by `a`. -/
theorem rawHist_affine {S B : Type*} [Fintype S] (pos : S → ℤ × ℤ) (w : B → S → ℝ → ℝ)
    (I : ℤ × ℤ → ℝ) {a : ℝ} (ha : 0 < a) (b : ℝ) :
    rawHist pos w (fun q => a * I q + b) = a • rawHist pos w I := by
  funext bin
  simp only [rawHist, gradAt_affine, Complex.arg_real_mul _ ha, norm_mul, Complex.norm_real,
    Real.norm_eq_abs, abs_of_pos ha, Pi.smul_apply, smul_eq_mul, mul_sum]
  congr 1
  funext s
  ring

/-- **At a fixed keypoint (position, scale and orientation), the SIFT descriptor is unchanged
when the layer becomes `a·I + b` with `a > 0`.**

* `I` is the blurred layer. Blurring and resizing commute with `I ↦ a·I + b`, because the
  kernels and the interpolation weights sum to 1, so a gain and offset on the input image give
  the same gain and offset on every layer (not proven here).
* In exact arithmetic OpenCV's orientation is also unchanged. Its histogram scales by `a`, the
  peak test is unchanged by a positive scale, and so is the parabola offset (`peakOffset_mul` in
  `OrientationPeak.lean`). The full orientation step is not proven here.
* This covers the descriptor only. Detection is not invariant: the DoG response scales by `a`,
  so the contrast threshold can add or drop keypoints. -/
theorem descriptor_affine_invariant {S B : Type*} [Fintype S] [Fintype B] (t : ℝ)
    (pos : S → ℤ × ℤ) (w : B → S → ℝ → ℝ) (I : ℤ × ℤ → ℝ) {a : ℝ} (ha : 0 < a) (b : ℝ) :
    siftNormalize t (rawHist pos w (fun q => a * I q + b)) = siftNormalize t (rawHist pos w I) := by
  rw [rawHist_affine pos w I ha b, siftNormalize_smul t ha]

end KeypointMath.SIFT
