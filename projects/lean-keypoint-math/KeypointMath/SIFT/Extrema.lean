import Mathlib.Algebra.Order.Archimedean.Real.Basic
import Mathlib.Algebra.Order.Floor.Ring
import KeypointMath.SIFT.Constants

/-!
# SIFT, step 3: extremum candidates

Claims checked here (Keypoint Detector Math, SIFT, "Extrema"):

* each sample is compared with its 26 neighbours in the 3 × 3 × 3 block around it, in its own
  DoG layer and the layers above and below (the count is `extremum_neighbours` in
  `Constants.lean`);
* OpenCV's test is not "larger than all 26 neighbours". It differs in three ways:
  - the comparisons are non-strict, so a sample that ties a neighbour can pass
    (`opencvCandidate_plateau`);
  - a positive sample must be a weak maximum and a negative sample a weak minimum. So a positive
    sample with any larger neighbour (for example a strict local minimum), or a negative sample
    with any smaller neighbour, is never a candidate (`opencvCandidate_pos`,
    `opencvCandidate_neg`);
  - `|D|` must be above a pre-threshold, `⌊0.5 · contrastThreshold / nOctaveLayers · 255⌋` in
    0–255 pixel units. That is 1 with the defaults and 3 with `contrastThreshold = 0.09`, and at
    most half of the final contrast threshold (`candidateThreshold_le`).

## The code being checked

OpenCV 4.12, `modules/features2d/src/sift.dispatch.cpp`, `findScaleSpaceExtrema`:

```cpp
const int threshold = cvFloor(0.5 * contrastThreshold / nOctaveLayers * 255 * SIFT_FIXPT_SCALE);
```

and `modules/features2d/src/sift.simd.hpp`, the scalar loop of `findScaleSpaceExtrema` (the SIMD
loop computes the same test):

```cpp
sift_wt val = currptr[c];
if (std::abs(val) <= threshold)
    continue;
if (val > 0)  { ... calculate = val >= each of the 26 neighbours ... }
else          { ... calculate = val <= each of the 26 neighbours ... }
```

`SIFT_FIXPT_SCALE` is 1 in the default `float` build, so `val` is in 0–255 pixel units.

Not modeled: the DoG values themselves (the 26 neighbours are any 26 numbers here), and the
5-pixel border that the loop skips (`SIFT_IMG_BORDER`).
-/

namespace KeypointMath.SIFT

/-- OpenCV's candidate test, in the code's shape: `|val| > thr`, then `val ≥` every neighbour if
`val > 0`, and `val ≤` every neighbour otherwise. `nb` lists the 26 neighbours. -/
def opencvCandidate (val thr : ℝ) (nb : Fin 26 → ℝ) : Prop :=
  thr < |val| ∧ if 0 < val then ∀ i, nb i ≤ val else ∀ i, val ≤ nb i

/-- **The test in symmetric form** (for a threshold `≥ 0`): a candidate is a weak maximum with
`val > thr`, or a weak minimum with `val < −thr`. -/
theorem opencvCandidate_iff {val thr : ℝ} (hthr : 0 ≤ thr) (nb : Fin 26 → ℝ) :
    opencvCandidate val thr nb ↔
      thr < |val| ∧ ((0 < val ∧ ∀ i, nb i ≤ val) ∨ (val < 0 ∧ ∀ i, val ≤ nb i)) := by
  unfold opencvCandidate
  constructor
  · rintro ⟨habs, h⟩
    refine ⟨habs, ?_⟩
    -- `split_ifs` gives one case per branch of the `if`.
    split_ifs at h with hpos
    · exact Or.inl ⟨hpos, h⟩
    · -- `val ≤ 0` and `|val| > thr ≥ 0`, so `val ≠ 0`, so `val < 0`.
      have hne : val ≠ 0 := fun h0 => by simp [h0] at habs; linarith
      exact Or.inr ⟨lt_of_le_of_ne (not_lt.mp hpos) hne, h⟩
  · -- `ite_eq_left` / `ite_eq_right`: an `if` equals its first / second branch when the
    -- condition holds / fails.
    rintro ⟨habs, ⟨hpos, h⟩ | ⟨hneg, h⟩⟩
    · exact ⟨habs, by rw [ite_eq_left hpos]; exact h⟩
    · exact ⟨habs, by rw [ite_eq_right (not_lt.mpr hneg.le)]; exact h⟩

/-- **A positive candidate is a (weak) local maximum.** So a positive sample with a larger
neighbour, such as a strict positive local minimum, is never a candidate. -/
theorem opencvCandidate_pos {val thr : ℝ} {nb : Fin 26 → ℝ} (h : opencvCandidate val thr nb)
    (hval : 0 < val) (i : Fin 26) : nb i ≤ val := by
  have h2 := h.2
  rw [ite_eq_left hval] at h2
  exact h2 i

/-- **A negative candidate is a (weak) local minimum.** -/
theorem opencvCandidate_neg {val thr : ℝ} {nb : Fin 26 → ℝ} (h : opencvCandidate val thr nb)
    (hval : val < 0) (i : Fin 26) : val ≤ nb i := by
  have h2 := h.2
  rw [ite_eq_right (not_lt.mpr hval.le)] at h2
  exact h2 i

/-- **Ties pass:** a flat patch of value `2`, with threshold `1`, is a candidate. -/
theorem opencvCandidate_plateau : opencvCandidate 2 1 (fun _ => 2) := by
  unfold opencvCandidate
  norm_num

/-- OpenCV's pre-threshold, `cvFloor(0.5 · contrastThreshold / nOctaveLayers · 255)`, in 0–255
pixel units. -/
noncomputable def candidateThreshold (contrastThreshold : ℝ) (layers : ℕ) : ℤ :=
  ⌊0.5 * contrastThreshold / layers * 255⌋

/-- With the defaults (`0.04`, 3 layers) the pre-threshold is `⌊1.7⌋ = 1`, so a candidate needs
`|D| > 1/255` on the `[0, 1]` scale. -/
theorem candidateThreshold_default :
    candidateThreshold OpenCV.contrastThreshold OpenCV.nOctaveLayers = 1 := by
  -- `Int.floor_eq_iff`: `⌊a⌋ = z ↔ z ≤ a ∧ a < z + 1`.
  rw [candidateThreshold, Int.floor_eq_iff]
  norm_num [OpenCV.contrastThreshold, OpenCV.nOctaveLayers]

/-- With Lowe's setting (`contrastThreshold = 0.09`) it is `⌊3.825⌋ = 3`. -/
theorem candidateThreshold_lowe : candidateThreshold 0.09 3 = 3 := by
  rw [candidateThreshold, Int.floor_eq_iff]
  norm_num

/-- **The pre-screen is at most half the final contrast threshold:** on the `[0, 1]` scale,
`⌊0.5 · T / S · 255⌋ / 255 ≤ (T / S) / 2`. -/
theorem candidateThreshold_le (T : ℝ) (S : ℕ) :
    (candidateThreshold T S : ℝ) / 255 ≤ T / S / 2 := by
  -- `Int.floor_le`: `⌊a⌋ ≤ a`.
  have h := Int.floor_le (0.5 * T / S * 255)
  have heq : 0.5 * T / S * 255 = T / S / 2 * 255 := by ring
  -- `div_le_iff₀`: `a / c ≤ b ↔ a ≤ b · c` for `c > 0`.
  rw [candidateThreshold, div_le_iff₀ (by norm_num)]
  linarith

end KeypointMath.SIFT
