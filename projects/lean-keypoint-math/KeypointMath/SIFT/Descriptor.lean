import Mathlib.Algebra.BigOperators.Fin
import Mathlib.Basic.Real.Basic
import Mathlib.Data.Fin.VecNotation
import Mathlib.Tactic.FinCases
import Mathlib.Tactic.Ring
import Mathlib.Tactic.Positivity
import Mathlib.Tactic.Linarith

/-!
# SIFT, step 8: spreading each sample over the descriptor bins

Claims checked here (Keypoint Detector Math, SIFT, "Descriptor"):

* trilinear interpolation splits each sample's weight over the 8 neighbouring
  (row, column, orientation) bins, with weights that are `≥ 0` and sum to 1;
* the split keeps the sample's position on average: the weighted mean bin index is the sample's
  fractional position, on each of the three axes;
* OpenCV's chain of multiplications and subtractions computes exactly these weights.

The counts `4 × 4 × 8 = 128` are in `Constants.lean`.

## The code being checked

OpenCV 4.12, `modules/features2d/src/sift.simd.hpp`, `calcSIFTDescriptor`, after
`rbin -= r0; cbin -= c0; obin -= o0;` (so each of `rbin`, `cbin`, `obin` is a fraction in
`[0, 1)`):

```cpp
float v_r1 = mag*rbin, v_r0 = mag - v_r1;
float v_rc11 = v_r1*cbin, v_rc10 = v_r1 - v_rc11;
float v_rc01 = v_r0*cbin, v_rc00 = v_r0 - v_rc01;
float v_rco111 = v_rc11*obin, v_rco110 = v_rc11 - v_rco111;
float v_rco101 = v_rc10*obin, v_rco100 = v_rc10 - v_rco101;
float v_rco011 = v_rc01*obin, v_rco010 = v_rc01 - v_rco011;
float v_rco001 = v_rc00*obin, v_rco000 = v_rc00 - v_rco001;
```

`v_rcoIJK` is added to bin `(r0 + I, c0 + J, o0 + K)`.

Not modeled: where the shares go after the split.

* OpenCV takes samples with `rbin` and `cbin` in `(−1, 4)`, and splats them into a padded
  6 × 6 × 10 array. It keeps only the 4 × 4 grid inside the padding. Shares that land in row or
  column −1 or 4 are discarded. For a uniform gradient field that is about a quarter of the
  splatted weight.
* The orientation axis wraps around: bins 8 and 9 of the padding are added to bins 0 and 1.
* The Gaussian window weight, the turn by the keypoint's angle, and `float` arithmetic.
-/

namespace KeypointMath.SIFT

open Finset

/-- Linear-interpolation weights for a fractional offset `d`: the lower bin gets `1 − d` and
the upper bin gets `d`. -/
def linWeight (d : ℝ) : Fin 2 → ℝ := ![1 - d, d]

/-- The trilinear weight of corner `(i, j, k)` (row, column, orientation); `1` is the upper
neighbour on that axis. -/
def triWeight (dr dc dθ : ℝ) (i j k : Fin 2) : ℝ :=
  linWeight dr i * linWeight dc j * linWeight dθ k

/-- **The 8 weights sum to 1**, so the split itself creates and destroys no weight.
OpenCV then discards the shares that land in the padding ring outside the 4 × 4 grid (row or
column −1 or 4). For a uniform gradient field that is about a quarter of the splatted weight. -/
theorem triWeight_sum (dr dc dθ : ℝ) : ∑ i, ∑ j, ∑ k, triWeight dr dc dθ i j k = 1 := by
  -- `Fin.sum_univ_two` expands each sum over `Fin 2`; `ring` collects the products.
  simp only [triWeight, linWeight, Fin.sum_univ_two]
  simp
  ring

/-- **Each weight is `≥ 0`** when the fractions lie in `[0, 1]`. -/
theorem triWeight_nonneg {dr dc dθ : ℝ} (hr0 : 0 ≤ dr) (hr1 : dr ≤ 1) (hc0 : 0 ≤ dc)
    (hc1 : dc ≤ 1) (hθ0 : 0 ≤ dθ) (hθ1 : dθ ≤ 1) (i j k : Fin 2) :
    0 ≤ triWeight dr dc dθ i j k := by
  have hl : ∀ {d : ℝ}, 0 ≤ d → d ≤ 1 → ∀ m : Fin 2, 0 ≤ linWeight d m := by
    intro d h0 h1 m
    fin_cases m <;> simp [linWeight] <;> linarith
  exact mul_nonneg (mul_nonneg (hl hr0 hr1 i) (hl hc0 hc1 j)) (hl hθ0 hθ1 k)

/-- **The split keeps the sample's position on average, along the row axis:** the weighted
mean of the row offsets (0 or 1) is `dr`. The column and orientation axes are the same by
symmetry. -/
theorem triWeight_mean_row (dr dc dθ : ℝ) :
    ∑ i, ∑ j, ∑ k, triWeight dr dc dθ i j k * (i : ℕ) = dr := by
  simp only [triWeight, linWeight, Fin.sum_univ_two]
  simp
  ring

/-- Along the column axis. -/
theorem triWeight_mean_col (dr dc dθ : ℝ) :
    ∑ i, ∑ j, ∑ k, triWeight dr dc dθ i j k * (j : ℕ) = dc := by
  simp only [triWeight, linWeight, Fin.sum_univ_two]
  simp
  ring

/-- Along the orientation axis. -/
theorem triWeight_mean_ori (dr dc dθ : ℝ) :
    ∑ i, ∑ j, ∑ k, triWeight dr dc dθ i j k * (k : ℕ) = dθ := by
  simp only [triWeight, linWeight, Fin.sum_univ_two]
  simp
  ring

/-- OpenCV's eight contributions, computed by the same chain of splits as `calcSIFTDescriptor`:
`v_r1 = mag·rbin`, `v_r0 = mag − v_r1`, then each of those split by `cbin`, then by `obin`.
Index `(i, j, k)` is `v_rcoIJK`. -/
def opencvSplat (mag rbin cbin obin : ℝ) (i j k : Fin 2) : ℝ :=
  let v_r : Fin 2 → ℝ := ![mag - mag * rbin, mag * rbin]
  let v_rc : Fin 2 → Fin 2 → ℝ := fun a => ![v_r a - v_r a * cbin, v_r a * cbin]
  let v_rco : Fin 2 → Fin 2 → Fin 2 → ℝ := fun a b =>
    ![v_rc a b - v_rc a b * obin, v_rc a b * obin]
  v_rco i j k

/-- **OpenCV's splits are the trilinear weights:** `v_rcoIJK = mag · triWeight(I, J, K)`. -/
theorem opencvSplat_eq (mag rbin cbin obin : ℝ) (i j k : Fin 2) :
    opencvSplat mag rbin cbin obin i j k = mag * triWeight rbin cbin obin i j k := by
  fin_cases i <;> fin_cases j <;> fin_cases k <;>
    · simp [opencvSplat, triWeight, linWeight]
      ring

/-- So OpenCV's eight contributions add up to the sample's weighted magnitude `mag`, before any
of them is discarded at the grid's edge. -/
theorem opencvSplat_sum (mag rbin cbin obin : ℝ) :
    ∑ i, ∑ j, ∑ k, opencvSplat mag rbin cbin obin i j k = mag := by
  simp only [opencvSplat_eq, ← Finset.mul_sum, triWeight_sum, mul_one]

end KeypointMath.SIFT
