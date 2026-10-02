import Mathlib.LinearAlgebra.Eigenspace.Basic
import Mathlib.LinearAlgebra.Matrix.ToLin
import Mathlib.LinearAlgebra.Matrix.Trace
import Mathlib.LinearAlgebra.Matrix.Determinant.Basic
import Mathlib.Analysis.SpecialFunctions.Sqrt
import KeypointMath.SIFT.Constants

/-!
# SIFT, step 6: the edge test

Claims checked here (Keypoint Detector Math, SIFT, "Edge test"):

* with `α, β` the eigenvalues of the 2×2 spatial Hessian and `r = α/β`,
  `Tr²/Det = (r + 1)²/r` (`trace_sq_div_det_hess2`);
* `(r + 1)²/r` grows with `r` for `r ≥ 1`, so the test `Tr²/Det < (r₀ + 1)²/r₀` says exactly
  `r < r₀`, where `r ≥ 1` is the eigenvalue of larger magnitude over the one of smaller
  magnitude;
* OpenCV's division-free test is the same test, and it rejects every point with `Det ≤ 0`.
  `Det < 0` means eigenvalues of opposite sign (a saddle); `Det = 0` means a zero eigenvalue.

At a DoG maximum both eigenvalues are negative, so "larger" and "smaller" refer to magnitudes:
for `diag(−4, −1)` the ratio is `4`, and `eigHi / eigLo = (−1)/(−4) = 1/4`.

## The code being checked

OpenCV 4.12, `modules/features2d/src/sift.simd.hpp`, `adjustLocalExtrema`:

```cpp
float tr = dxx + dyy;
float det = dxx * dyy - dxy * dxy;
if( det <= 0 || tr*tr*edgeThreshold >= (edgeThreshold + 1)*(edgeThreshold + 1)*det )
    return false;
```

`edgeThreshold` defaults to 10, Lowe's `r = 10`.

Not modeled: the finite differences that give `dxx`, `dyy` and `dxy` from the DoG samples, and
`float` arithmetic. The theorems take the three numbers as given.

## Eigenvalues

The Hessian is `[[Dxx, Dxy], [Dxy, Dyy]]`. Its eigenvalues are written out with the quadratic
formula (`eigHi`, `eigLo`). `isEigenvalue_iff` proves these are exactly its eigenvalues, using
Mathlib's definition: `Module.End.HasEigenvalue` of the linear map `v ↦ H v`.
-/

namespace KeypointMath.SIFT

open Matrix

/-- The 2×2 spatial Hessian of the DoG, `[[Dxx, Dxy], [Dxy, Dyy]]`. -/
def hess2 (dxx dxy dyy : ℝ) : Matrix (Fin 2) (Fin 2) ℝ := !![dxx, dxy; dxy, dyy]

theorem trace_hess2 (dxx dxy dyy : ℝ) : (hess2 dxx dxy dyy).trace = dxx + dyy :=
  trace_fin_two_of _ _ _ _

theorem det_hess2 (dxx dxy dyy : ℝ) : (hess2 dxx dxy dyy).det = dxx * dyy - dxy * dxy := by
  rw [hess2, det_fin_two_of]

/-- `μ` is an eigenvalue of `M`: Mathlib's `HasEigenvalue` for the linear map `v ↦ M v`. -/
abbrev IsEigenvalue (M : Matrix (Fin 2) (Fin 2) ℝ) (μ : ℝ) : Prop :=
  Module.End.HasEigenvalue (Matrix.toLin' M) μ

/-- The discriminant `Tr² − 4·Det`, written in a form that is visibly `≥ 0`. -/
theorem disc_hess2 (dxx dxy dyy : ℝ) :
    (dxx + dyy) ^ 2 - 4 * (dxx * dyy - dxy * dxy) = (dxx - dyy) ^ 2 + 4 * dxy ^ 2 := by ring

/-- The larger eigenvalue, `(Tr + √(Tr² − 4·Det))/2`. -/
noncomputable def eigHi (dxx dxy dyy : ℝ) : ℝ :=
  ((dxx + dyy) + Real.sqrt ((dxx - dyy) ^ 2 + 4 * dxy ^ 2)) / 2

/-- The smaller eigenvalue, `(Tr − √(Tr² − 4·Det))/2`. -/
noncomputable def eigLo (dxx dxy dyy : ℝ) : ℝ :=
  ((dxx + dyy) - Real.sqrt ((dxx - dyy) ^ 2 + 4 * dxy ^ 2)) / 2

/-- `α + β = Tr`. -/
theorem eig_sum (dxx dxy dyy : ℝ) : eigHi dxx dxy dyy + eigLo dxx dxy dyy = dxx + dyy := by
  rw [eigHi, eigLo]
  ring

/-- `α · β = Det`. -/
theorem eig_prod (dxx dxy dyy : ℝ) :
    eigHi dxx dxy dyy * eigLo dxx dxy dyy = dxx * dyy - dxy * dxy := by
  -- `Real.sq_sqrt`: `(√d)² = d` for `d ≥ 0`; `linear_combination` checks the rest.
  have hR := Real.sq_sqrt (show 0 ≤ (dxx - dyy) ^ 2 + 4 * dxy ^ 2 by positivity)
  rw [eigHi, eigLo]
  linear_combination (-1 / 4 : ℝ) * hR

/-- The characteristic polynomial factors: `(Dxx − μ)(Dyy − μ) − Dxy² = (μ − α)(μ − β)`. -/
theorem charpoly_hess2 (dxx dxy dyy μ : ℝ) :
    (dxx - μ) * (dyy - μ) - dxy * dxy = (μ - eigHi dxx dxy dyy) * (μ - eigLo dxx dxy dyy) := by
  linear_combination μ * eig_sum dxx dxy dyy - eig_prod dxx dxy dyy

/-- Every root of the characteristic polynomial is an eigenvalue: there is a nonzero `v` with
`H v = μ v`. -/
theorem isEigenvalue_of_charpoly {dxx dxy dyy μ : ℝ}
    (hμ : (dxx - μ) * (dyy - μ) - dxy * dxy = 0) : IsEigenvalue (hess2 dxx dxy dyy) μ := by
  -- Reduce `HasEigenvalue` to an explicit eigenvector (`hasEigenvalue_of_hasEigenvector`,
  -- `hasEigenvector_iff`, `mem_eigenspace_iff`, `toLin'_apply`).
  suffices h : ∃ v : Fin 2 → ℝ, v ≠ 0 ∧ hess2 dxx dxy dyy *ᵥ v = μ • v by
    obtain ⟨v, hv0, hv⟩ := h
    apply Module.End.hasEigenvalue_of_hasEigenvector (x := v)
    rw [Module.End.hasEigenvector_iff, Module.End.mem_eigenspace_iff, toLin'_apply]
    exact ⟨hv, hv0⟩
  by_cases hb : dxy = 0
  · -- Diagonal case: the eigenvalues are `Dxx` and `Dyy`, with the unit vectors.
    subst hb
    have : (dxx - μ) * (dyy - μ) = 0 := by linarith
    rcases mul_eq_zero.mp this with h | h
    · refine ⟨![1, 0], fun h0 => by simpa using congrFun h0 0, ?_⟩
      ext i
      fin_cases i
      · simp [hess2, mulVec, dotProduct, Fin.sum_univ_two]
        linarith
      · simp [hess2, mulVec, dotProduct, Fin.sum_univ_two]
    · refine ⟨![0, 1], fun h0 => by simpa using congrFun h0 1, ?_⟩
      ext i
      fin_cases i
      · simp [hess2, mulVec, dotProduct, Fin.sum_univ_two]
      · simp [hess2, mulVec, dotProduct, Fin.sum_univ_two]
        linarith
  · -- Off-diagonal case: `v = (Dxy, μ − Dxx)` works, and `v ≠ 0` because `Dxy ≠ 0`.
    refine ⟨![dxy, μ - dxx], fun h0 => hb (by simpa using congrFun h0 0), ?_⟩
    ext i
    fin_cases i
    · simp [hess2, mulVec, dotProduct, Fin.sum_univ_two]
      ring
    · simp [hess2, mulVec, dotProduct, Fin.sum_univ_two]
      linear_combination -hμ

/-- **`eigHi` and `eigLo` are exactly the eigenvalues of the Hessian**, in Mathlib's sense. -/
theorem isEigenvalue_iff (dxx dxy dyy μ : ℝ) :
    IsEigenvalue (hess2 dxx dxy dyy) μ ↔ μ = eigHi dxx dxy dyy ∨ μ = eigLo dxx dxy dyy := by
  constructor
  · intro h
    -- An eigenvalue has an eigenvector (`HasEigenvalue.exists_hasEigenvector`).
    obtain ⟨v, hv⟩ := h.exists_hasEigenvector
    rw [Module.End.hasEigenvector_iff, Module.End.mem_eigenspace_iff, toLin'_apply] at hv
    obtain ⟨hHv, hv0⟩ := hv
    -- The two coordinates of `H v = μ v`, written out.
    have h0 : dxx * v 0 + dxy * v 1 = μ * v 0 := by
      simpa [hess2, mulVec, dotProduct, Fin.sum_univ_two] using congrFun hHv 0
    have h1 : dxy * v 0 + dyy * v 1 = μ * v 1 := by
      simpa [hess2, mulVec, dotProduct, Fin.sum_univ_two] using congrFun hHv 1
    -- `χ(μ)·v₀ = 0` and `χ(μ)·v₁ = 0`, where `χ(μ) = (Dxx − μ)(Dyy − μ) − Dxy²`.
    have e0 : ((dxx - μ) * (dyy - μ) - dxy * dxy) * v 0 = 0 := by
      linear_combination (dyy - μ) * h0 - dxy * h1
    have e1 : ((dxx - μ) * (dyy - μ) - dxy * dxy) * v 1 = 0 := by
      linear_combination (dxx - μ) * h1 - dxy * h0
    -- `v ≠ 0`, so one coordinate is nonzero, so `χ(μ) = 0`.
    have hχ : (dxx - μ) * (dyy - μ) - dxy * dxy = 0 := by
      by_contra hne
      apply hv0
      ext i
      fin_cases i
      · exact (mul_eq_zero.mp e0).resolve_left hne
      · exact (mul_eq_zero.mp e1).resolve_left hne
    -- `χ(μ) = (μ − α)(μ − β)`, and a product is zero only if a factor is (`mul_eq_zero`).
    rw [charpoly_hess2] at hχ
    rcases mul_eq_zero.mp hχ with h | h
    · exact Or.inl (by linarith)
    · exact Or.inr (by linarith)
  · rintro (rfl | rfl)
    · exact isEigenvalue_of_charpoly (by rw [charpoly_hess2]; ring)
    · exact isEigenvalue_of_charpoly (by rw [charpoly_hess2]; ring)

/-! ### The test itself -/

/-- **`Tr²/Det = (r + 1)²/r`** with `r = α/β`, for nonzero `α, β`. -/
theorem trace_sq_div_det_eq {α β : ℝ} (hα : α ≠ 0) (hβ : β ≠ 0) :
    (α + β) ^ 2 / (α * β) = (α / β + 1) ^ 2 / (α / β) := by
  field_simp

/-- The same identity for the Hessian itself, with `α = eigHi`, `β = eigLo`. -/
theorem trace_sq_div_det_hess2 {dxx dxy dyy : ℝ} (hα : eigHi dxx dxy dyy ≠ 0)
    (hβ : eigLo dxx dxy dyy ≠ 0) :
    (hess2 dxx dxy dyy).trace ^ 2 / (hess2 dxx dxy dyy).det =
      (eigHi dxx dxy dyy / eigLo dxx dxy dyy + 1) ^ 2 /
        (eigHi dxx dxy dyy / eigLo dxx dxy dyy) := by
  rw [trace_hess2, det_hess2, ← eig_sum, ← eig_prod]
  exact trace_sq_div_det_eq hα hβ

/-- **`(r + 1)²/r` is increasing for `r ≥ 1`**, so for a ratio `r ≥ 1` (the eigenvalue of larger
magnitude over the one of smaller magnitude) the test `(r + 1)²/r < (r₀ + 1)²/r₀` holds exactly
when `r < r₀`. -/
theorem edge_fn_lt_iff {r r₀ : ℝ} (hr : 1 ≤ r) (hr₀ : 1 ≤ r₀) :
    (r + 1) ^ 2 / r < (r₀ + 1) ^ 2 / r₀ ↔ r < r₀ := by
  -- `div_lt_div_iff₀`: `a/b < c/d ↔ a·d < c·b` for `b, d > 0`.
  rw [div_lt_div_iff₀ (by linarith) (by linarith)]
  -- `(r + 1)²r₀ − (r₀ + 1)²r = (r − r₀)(r r₀ − 1)`, and `r r₀ ≥ 1`.
  constructor
  · intro h
    by_contra hc
    push Not at hc
    nlinarith [mul_nonneg (sub_nonneg.mpr hc) (show (0 : ℝ) ≤ r * r₀ - 1 by nlinarith)]
  · intro h
    nlinarith [mul_pos (sub_pos.mpr h) (show (0 : ℝ) < r * r₀ - 1 by nlinarith)]

/-- **The core equivalence.** For eigenvalues of the same sign (`αβ > 0`) and `r₀ ≥ 1`:
`(α + β)²·r₀ < (r₀ + 1)²·αβ` exactly when both ratios `α/β` and `β/α` are below `r₀`.
The proof rests on `(α + β)²r₀ − (r₀ + 1)²αβ = (r₀α − β)(α − r₀β)`. -/
theorem ratio_test_iff {α β r₀ : ℝ} (hαβ : 0 < α * β) (hr₀ : 1 ≤ r₀) :
    (α + β) ^ 2 * r₀ < (r₀ + 1) ^ 2 * (α * β) ↔ α / β < r₀ ∧ β / α < r₀ := by
  have hr₀' : (0 : ℝ) ≤ r₀ ^ 2 - 1 := by nlinarith
  have hr₀0 : (0 : ℝ) ≤ r₀ := by linarith
  -- `pos_and_pos_or_neg_and_neg_of_mul_pos`: `0 < αβ` means same signs.
  rcases pos_and_pos_or_neg_and_neg_of_mul_pos hαβ with ⟨hα, hβ⟩ | ⟨hα, hβ⟩
  · -- Both positive. `div_lt_iff₀`: `a/c < b ↔ a < b·c` for `c > 0`.
    rw [div_lt_iff₀ hβ, div_lt_iff₀ hα]
    constructor
    · intro h
      constructor
      · by_contra hc
        push Not at hc
        nlinarith [mul_nonneg hr₀0 (sq_nonneg (α - r₀ * β)),
          mul_nonneg (mul_nonneg hr₀' hβ.le) (sub_nonneg.mpr hc)]
      · by_contra hc
        push Not at hc
        nlinarith [mul_nonneg hr₀0 (sq_nonneg (r₀ * α - β)),
          mul_nonneg (mul_nonneg hr₀' hα.le) (sub_nonneg.mpr hc)]
    · rintro ⟨h1, h2⟩
      nlinarith [mul_pos (sub_pos.mpr h2) (sub_pos.mpr h1)]
  · -- Both negative. `div_lt_iff_of_neg`: `a/c < b ↔ b·c < a` for `c < 0`.
    rw [div_lt_iff_of_neg hβ, div_lt_iff_of_neg hα]
    constructor
    · intro h
      constructor
      · by_contra hc
        push Not at hc
        nlinarith [mul_nonneg hr₀0 (sq_nonneg (α - r₀ * β)),
          mul_nonneg (mul_nonneg hr₀' (neg_nonneg.mpr hβ.le)) (sub_nonneg.mpr hc)]
      · by_contra hc
        push Not at hc
        nlinarith [mul_nonneg hr₀0 (sq_nonneg (r₀ * α - β)),
          mul_nonneg (mul_nonneg hr₀' (neg_nonneg.mpr hα.le)) (sub_nonneg.mpr hc)]
    · rintro ⟨h1, h2⟩
      nlinarith [mul_pos (sub_pos.mpr h1) (sub_pos.mpr h2)]

/-- **Lowe's form and OpenCV's form are the same test** when `Det > 0`:
`Tr²/Det < (r₀ + 1)²/r₀ ↔ Tr²·r₀ < (r₀ + 1)²·Det`. -/
theorem lowe_iff_opencv {tr det r₀ : ℝ} (hdet : 0 < det) (hr₀ : 0 < r₀) :
    tr ^ 2 / det < (r₀ + 1) ^ 2 / r₀ ↔ tr ^ 2 * r₀ < (r₀ + 1) ^ 2 * det :=
  div_lt_div_iff₀ hdet hr₀

/-- OpenCV's rejection test, verbatim:
`det <= 0 || tr*tr*edgeThreshold >= (edgeThreshold + 1)*(edgeThreshold + 1)*det`. -/
def opencvEdgeReject (dxx dxy dyy edgeThreshold : ℝ) : Prop :=
  let tr := dxx + dyy
  let det := dxx * dyy - dxy * dxy
  det ≤ 0 ∨ tr * tr * edgeThreshold ≥ (edgeThreshold + 1) * (edgeThreshold + 1) * det

/-- **OpenCV keeps a point exactly when the Hessian's eigenvalues have the same sign and each
eigenvalue's magnitude is less than `r₀` times the other's** (`α/β < r₀` and `β/α < r₀`, with
`r₀ = edgeThreshold`, default 10). `Det < 0` (a saddle) and `Det = 0` (a zero eigenvalue) are
always rejected. -/
theorem opencv_edge_keep_iff (dxx dxy dyy r₀ : ℝ) (hr₀ : 1 ≤ r₀) :
    ¬ opencvEdgeReject dxx dxy dyy r₀ ↔
      0 < eigHi dxx dxy dyy * eigLo dxx dxy dyy ∧
        eigHi dxx dxy dyy / eigLo dxx dxy dyy < r₀ ∧
        eigLo dxx dxy dyy / eigHi dxx dxy dyy < r₀ := by
  -- Unfold the test: not rejected ⟺ `Det > 0` and `Tr²·r₀ < (r₀ + 1)²·Det`.
  simp only [opencvEdgeReject, not_or, not_le, ge_iff_le]
  -- Write `Tr` and `Det` with the eigenvalues (`eig_sum`, `eig_prod`).
  rw [← eig_sum dxx dxy dyy, ← eig_prod dxx dxy dyy]
  constructor
  · rintro ⟨hdet, htest⟩
    refine ⟨hdet, (ratio_test_iff hdet hr₀).mp ?_⟩
    nlinarith [htest]
  · rintro ⟨hdet, hratio⟩
    refine ⟨hdet, ?_⟩
    have := (ratio_test_iff hdet hr₀).mpr hratio
    nlinarith [this]

/-! ### OpenCV's default, `edgeThreshold = 10`

Lowe's paper uses `r = 10` as well, so `(r + 1)²/r = 12.1`.
Two concrete Hessians show both outcomes. -/

example : (OpenCV.edgeThreshold + 1) ^ 2 / OpenCV.edgeThreshold = 12.1 := by
  norm_num [OpenCV.edgeThreshold]

/-- `diag(−4, −1)`: a DoG maximum (both eigenvalues negative), magnitude ratio 4 < 10, kept. -/
example : ¬ opencvEdgeReject (-4) 0 (-1) OpenCV.edgeThreshold := by
  simp only [opencvEdgeReject, OpenCV.edgeThreshold]
  norm_num

/-- `diag(−20, −1)`: an edge, magnitude ratio 20 ≥ 10, rejected. -/
example : opencvEdgeReject (-20) 0 (-1) OpenCV.edgeThreshold := by
  simp only [opencvEdgeReject, OpenCV.edgeThreshold]
  norm_num

/-- A saddle, `diag(−1, 1)` (`Det < 0`), is rejected. -/
example : opencvEdgeReject (-1) 0 1 OpenCV.edgeThreshold := by
  simp only [opencvEdgeReject, OpenCV.edgeThreshold]
  norm_num

/-- For the kept `diag(−4, −1)`, `eigHi / eigLo = 1/4`: the ratio of larger to smaller
magnitude is `eigLo / eigHi = 4`. -/
example : eigHi (-4) 0 (-1) / eigLo (-4) 0 (-1) = 1 / 4 := by
  have h : Real.sqrt (((-4 : ℝ) - (-1)) ^ 2 + 4 * 0 ^ 2) = 3 := by
    rw [show ((-4 : ℝ) - (-1)) ^ 2 + 4 * 0 ^ 2 = 3 ^ 2 by norm_num, Real.sqrt_sq (by norm_num)]
  simp only [eigHi, eigLo, h]
  norm_num

end KeypointMath.SIFT
