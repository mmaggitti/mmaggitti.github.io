import Mathlib.LinearAlgebra.Matrix.PosDef
import Mathlib.LinearAlgebra.Matrix.NonsingularInverse
import Mathlib.Analysis.Calculus.Deriv.Pow
import Mathlib.Analysis.Calculus.Deriv.Mul
import Mathlib.Analysis.Calculus.Deriv.Add
import KeypointMath.SIFT.Constants

/-!
# SIFT, steps 4–5: the sub-pixel fit and the contrast value

Claims checked here (Keypoint Detector Math, SIFT, "Sub-pixel fit" and "Contrast test"):

* `x̂ = −H⁻¹∇D` is the stationary point of the second-order model
  `q(x) = D + ∇Dᵀx + ½ xᵀHx`, and the only one when `H` is invertible and symmetric;
* `x̂` is the model's minimum when `H` is positive definite and its maximum when `H` is
  negative definite;
* the model's value there is exactly `D(x̂) = D + ½ ∇Dᵀx̂`, the value OpenCV thresholds
  (`opencvContr_eq`, `opencv_contrast_reject_iff`).

OpenCV never checks that `H` is definite, so an accepted keypoint can be a saddle point of the
model. The minimum and maximum theorems apply only under their hypotheses.

OpenCV computes `D = L(kσ) − L(σ)` (`subtract(src2, src1, ...)` in `buildDoGPyramid`). So a
bright point is a DoG *minimum* (`dog_center_min` in `DoG.lean`), and a dark point a DoG
*maximum*. Read the same way for blobs, a bright blob on a darker surround is a minimum and a
dark blob on a lighter surround a maximum; that case is not proven. Both kinds are detected.

## The code being checked

OpenCV 4.12, `modules/features2d/src/sift.simd.hpp`, `adjustLocalExtrema`:

```cpp
Vec3f X = H.solve(dD, DECOMP_LU);            // X = H⁻¹ ∇D
xi = -X[2]; xr = -X[1]; xc = -X[0];          // x̂ = −H⁻¹ ∇D
...
float t = dD.dot(Matx31f(xc, xr, xi));       // t = ∇Dᵀ x̂
contr = img.at<sift_wt>(r, c)*img_scale + t * 0.5f;
if( std::abs( contr ) * nOctaveLayers < contrastThreshold )
    return false;
```

## Model

Vectors are functions `n → ℝ` and matrices are Mathlib's `Matrix n n ℝ`, for any finite index
type `n`. SIFT uses `n = Fin 3`: offsets in column, row and scale. `g` is the gradient `∇D` and
`H` the Hessian, both by finite differences in OpenCV.

* `g ⬝ᵥ x` is the dot product (`dotProduct`).
* `H *ᵥ x` is the matrix–vector product (`Matrix.mulVec`).
* A stationary point is one where the derivative along every direction `v` is 0 (`IsStationary`).

Not modeled: the re-centering loop. While any coordinate of the offset has `|x̂ᵢ| ≥ 0.5`, OpenCV
moves the sample by `cvRound(x̂)` (column, row and layer; a move can be more than one sample) and
fits again. It fits at most `SIFT_MAX_INTERP_STEPS = 5` times in all. It rejects the point if the
fit never converges, or if the point leaves layers `1..nOctaveLayers` or comes within
`SIFT_IMG_BORDER = 5` pixels of the border. The theorems below are about one fit. Also not
modeled: the finite differences that give `g` and `H`, and `float` arithmetic.
-/

namespace KeypointMath.SIFT

open Matrix

variable {n : Type*} [Fintype n] [DecidableEq n]

/-- The second-order Taylor model of the DoG around a sample:
`q(x) = D + gᵀx + ½ xᵀHx`, with `g = ∇D` and `H` the Hessian. -/
noncomputable def quadModel (D : ℝ) (g : n → ℝ) (H : Matrix n n ℝ) (x : n → ℝ) : ℝ :=
  D + g ⬝ᵥ x + (1 / 2) * (x ⬝ᵥ (H *ᵥ x))

/-- OpenCV's offset: `X = H.solve(dD)`, then `x̂ = −X`, i.e. `x̂ = −H⁻¹g`. -/
noncomputable def newtonStep (g : n → ℝ) (H : Matrix n n ℝ) : n → ℝ := -(H⁻¹ *ᵥ g)

/-- `H x̂ = −g` when `H` is invertible: `x̂` solves the linear system OpenCV solves. -/
theorem mulVec_newtonStep (g : n → ℝ) {H : Matrix n n ℝ} (hH : IsUnit H.det) :
    H *ᵥ newtonStep g H = -g := by
  -- `mulVec_neg`, then `mulVec_mulVec`: H (H⁻¹ g) = (H H⁻¹) g, `mul_nonsing_inv`: H H⁻¹ = 1.
  rw [newtonStep, mulVec_neg, mulVec_mulVec, mul_nonsing_inv _ hH, one_mulVec]

omit [DecidableEq n] in
/-- For a symmetric `H`, `uᵀHv = vᵀHu`. -/
theorem dotProduct_mulVec_comm {H : Matrix n n ℝ} (hH : H.IsSymm) (u v : n → ℝ) :
    u ⬝ᵥ (H *ᵥ v) = v ⬝ᵥ (H *ᵥ u) := by
  -- `dotProduct_mulVec`: uᵀ(Hv) = (uᵀH)v; `mulVec_transpose`: Hᵀu = uᵀH; `hH.eq`: Hᵀ = H.
  rw [dotProduct_mulVec, ← mulVec_transpose, hH.eq, dotProduct_comm]

omit [DecidableEq n] in
/-- **The model around any point `x`:**
`q(x + v) = q(x) + (g + Hx)ᵀv + ½ vᵀHv` for symmetric `H`. The linear term `g + Hx` is the
gradient of the model at `x`. -/
theorem quadModel_add (D : ℝ) (g : n → ℝ) {H : Matrix n n ℝ} (hH : H.IsSymm) (x v : n → ℝ) :
    quadModel D g H (x + v) =
      quadModel D g H x + (g + H *ᵥ x) ⬝ᵥ v + (1 / 2) * (v ⬝ᵥ (H *ᵥ v)) := by
  -- Expand the bilinear terms (`mulVec_add`, `dotProduct_add`, `add_dotProduct`).
  simp only [quadModel, mulVec_add, dotProduct_add, add_dotProduct]
  -- The two cross terms are equal for symmetric `H`, and `(Hx)ᵀv = vᵀ(Hx)`.
  rw [dotProduct_mulVec_comm hH x v, dotProduct_comm (H *ᵥ x) v]
  ring

/-- **Completing the square.** At `x̂ = −H⁻¹g` the linear term vanishes:
`q(x̂ + v) = q(x̂) + ½ vᵀHv` for every offset `v`. -/
theorem quadModel_newtonStep_add (D : ℝ) (g : n → ℝ) {H : Matrix n n ℝ} (hH : H.IsSymm)
    (hdet : IsUnit H.det) (v : n → ℝ) :
    quadModel D g H (newtonStep g H + v) =
      quadModel D g H (newtonStep g H) + (1 / 2) * (v ⬝ᵥ (H *ᵥ v)) := by
  -- `g + H x̂ = g − g = 0` (`add_neg_cancel`), and `0 ⬝ᵥ v = 0` (`zero_dotProduct`).
  rw [quadModel_add D g hH, mulVec_newtonStep g hdet, add_neg_cancel, zero_dotProduct, add_zero]

/-- **The contrast value.** The model's value at `x̂` is `D + ½ gᵀx̂`.
Only `H x̂ = −g` is used, so `H` need not be symmetric. -/
theorem quadModel_newtonStep (D : ℝ) (g : n → ℝ) {H : Matrix n n ℝ} (hdet : IsUnit H.det) :
    quadModel D g H (newtonStep g H) = D + (1 / 2) * (g ⬝ᵥ newtonStep g H) := by
  -- `x̂ᵀ(H x̂) = x̂ᵀ(−g) = −gᵀx̂` (`dotProduct_neg`, `dotProduct_comm`).
  rw [quadModel, mulVec_newtonStep g hdet, dotProduct_neg, dotProduct_comm (newtonStep g H) g]
  ring

/-- OpenCV's `contr`, term for term: `img(r, c)·img_scale + t·0.5` with `t = dD·x̂`. -/
noncomputable def opencvContr (D : ℝ) (g : n → ℝ) (H : Matrix n n ℝ) : ℝ :=
  D + (g ⬝ᵥ newtonStep g H) * 0.5

/-- **OpenCV's `contr` is the model's value at the fitted extremum.** No invertibility
hypothesis is needed. For a singular `H`, Mathlib's `H⁻¹` is 0, so `x̂ = 0` and both sides are
`D`. OpenCV agrees: `Matx::solve` returns zeros when `det == 0`. -/
theorem opencvContr_eq (D : ℝ) (g : n → ℝ) (H : Matrix n n ℝ) :
    opencvContr D g H = quadModel D g H (newtonStep g H) := by
  by_cases hdet : IsUnit H.det
  · rw [quadModel_newtonStep D g hdet, opencvContr]
    ring
  · -- `nonsing_inv_apply_not_isUnit`: `H⁻¹ = 0` when `det H` is not a unit.
    have h0 : newtonStep g H = 0 := by
      rw [newtonStep, nonsing_inv_apply_not_isUnit _ hdet, zero_mulVec, neg_zero]
    simp [opencvContr, quadModel, h0]

/-- **OpenCV's contrast test, in terms of the model:** OpenCV rejects the point exactly when
the model's value at the fitted extremum is below `contrastThreshold / nOctaveLayers` in size.
`OpenCV.contrastReject` is the test verbatim (`Constants.lean`). -/
theorem opencv_contrast_reject_iff (D : ℝ) (g : n → ℝ) (H : Matrix n n ℝ) {layers : ℕ}
    (hl : 0 < layers) (threshold : ℝ) :
    OpenCV.contrastReject (opencvContr D g H) layers threshold ↔
      |quadModel D g H (newtonStep g H)| < threshold / layers := by
  rw [OpenCV.contrastReject_iff _ hl, opencvContr_eq]

omit [DecidableEq n] in
/-- **The derivative along a line.** For symmetric `H`, the model's derivative at `x` in the
direction `v` is `(g + Hx)ᵀv`. -/
theorem hasDerivAt_quadModel_line (D : ℝ) (g : n → ℝ) {H : Matrix n n ℝ} (hH : H.IsSymm)
    (x v : n → ℝ) :
    HasDerivAt (fun t : ℝ => quadModel D g H (x + t • v)) ((g + H *ᵥ x) ⬝ᵥ v) 0 := by
  -- Along the line the model is the quadratic `a + b t + c t²`.
  have hline : (fun t : ℝ => quadModel D g H (x + t • v)) = fun t =>
      quadModel D g H x + t * ((g + H *ᵥ x) ⬝ᵥ v) + t ^ 2 * ((1 / 2) * (v ⬝ᵥ (H *ᵥ v))) := by
    funext t
    -- `mulVec_smul`, `dotProduct_smul`, `smul_dotProduct` move the scalar `t` out.
    rw [quadModel_add D g hH]
    simp only [mulVec_smul, dotProduct_smul, smul_dotProduct, smul_eq_mul]
    ring
  rw [hline]
  -- Its derivative at 0 is `b`: `hasDerivAt_mul_const` gives `t ↦ t·b`, `hasDerivAt_pow`
  -- gives `t ↦ t²` (derivative `2·0 = 0` at 0), and `.const_add`, `.add` assemble the sum.
  have h1 : HasDerivAt (fun t : ℝ => t * ((g + H *ᵥ x) ⬝ᵥ v)) ((g + H *ᵥ x) ⬝ᵥ v) 0 :=
    hasDerivAt_mul_const _
  have h2 := (hasDerivAt_pow 2 (0 : ℝ)).mul_const ((1 / 2) * (v ⬝ᵥ (H *ᵥ v)))
  -- `HasDerivAt.fun_add` is the sum rule for `fun t => f t + g t`.
  have h := (h1.const_add (quadModel D g H x)).fun_add h2
  convert h using 1
  simp

/-- `x` is a **stationary point** of the model: its derivative along every direction is 0. -/
def IsStationary (D : ℝ) (g : n → ℝ) (H : Matrix n n ℝ) (x : n → ℝ) : Prop :=
  ∀ v : n → ℝ, HasDerivAt (fun t : ℝ => quadModel D g H (x + t • v)) 0 0

/-- **`x̂ = −H⁻¹g` is the one and only stationary point** of the model, for an invertible
symmetric `H`. -/
theorem isStationary_iff (D : ℝ) (g : n → ℝ) {H : Matrix n n ℝ} (hH : H.IsSymm)
    (hdet : IsUnit H.det) (x : n → ℝ) :
    IsStationary D g H x ↔ x = newtonStep g H := by
  constructor
  · intro hx
    -- Derivatives are unique (`HasDerivAt.unique`), so `(g + Hx)ᵀv = 0` for every `v`.
    -- Taking `v = g + Hx` gives `|g + Hx|² = 0`, so `g + Hx = 0` (`dotProduct_self_eq_zero`).
    have hgrad : g + H *ᵥ x = 0 := by
      have h0 := (hx (g + H *ᵥ x)).unique (hasDerivAt_quadModel_line D g hH x (g + H *ᵥ x))
      exact dotProduct_self_eq_zero.mp h0.symm
    -- `eq_neg_of_add_eq_zero_right`: `a + b = 0 → b = −a`.
    have hHx : H *ᵥ x = -g := eq_neg_of_add_eq_zero_right hgrad
    -- Multiply by `H⁻¹` (`nonsing_inv_mul`: H⁻¹ H = 1).
    calc x = H⁻¹ *ᵥ (H *ᵥ x) := by rw [mulVec_mulVec, nonsing_inv_mul _ hdet, one_mulVec]
      _ = newtonStep g H := by rw [hHx, mulVec_neg, newtonStep]
  · rintro rfl v
    have h := hasDerivAt_quadModel_line D g hH (newtonStep g H) v
    rwa [mulVec_newtonStep g hdet, add_neg_cancel, zero_dotProduct] at h

omit [Fintype n] [DecidableEq n] in
/-- Over `ℝ`, `star v = v` for a vector; used to read Mathlib's `PosDef` (stated with `star`). -/
theorem star_vec (v : n → ℝ) : star v = v := by
  funext i
  simp

/-- **A minimum when `H` is positive definite** (a DoG minimum, such as a bright blob on a
darker surround): `q(x̂) < q(x)` for all `x ≠ x̂`. -/
theorem quadModel_newtonStep_lt_of_posDef (D : ℝ) (g : n → ℝ) {H : Matrix n n ℝ}
    (hH : H.PosDef) {x : n → ℝ} (hx : x ≠ newtonStep g H) :
    quadModel D g H (newtonStep g H) < quadModel D g H x := by
  -- `PosDef` gives symmetry (`isHermitian`, then `IsHermitian.isSymm` over `ℝ`) and
  -- invertibility (`PosDef.isUnit`, then `isUnit_iff_isUnit_det`).
  have hsymm : H.IsSymm := hH.isHermitian.isSymm
  have hdet : IsUnit H.det := (isUnit_iff_isUnit_det H).mp hH.isUnit
  -- Write `x = x̂ + v` with `v ≠ 0`; then `q(x) = q(x̂) + ½ vᵀHv` and `vᵀHv > 0`.
  have hv : x - newtonStep g H ≠ 0 := sub_ne_zero.mpr hx
  have hpos := hH.dotProduct_mulVec_pos hv
  rw [star_vec] at hpos
  have hsplit : x = newtonStep g H + (x - newtonStep g H) := (add_sub_cancel _ _).symm
  rw [hsplit, quadModel_newtonStep_add D g hsymm hdet]
  linarith

/-- The non-strict form of the minimum. -/
theorem quadModel_newtonStep_le_of_posDef (D : ℝ) (g : n → ℝ) {H : Matrix n n ℝ}
    (hH : H.PosDef) (x : n → ℝ) :
    quadModel D g H (newtonStep g H) ≤ quadModel D g H x := by
  by_cases hx : x = newtonStep g H
  · rw [hx]
  · exact (quadModel_newtonStep_lt_of_posDef D g hH hx).le

/-- **A maximum when `H` is negative definite** (a DoG maximum, such as a dark blob on a
lighter surround): `q(x) < q(x̂)` for all `x ≠ x̂`. -/
theorem quadModel_lt_newtonStep_of_negDef (D : ℝ) (g : n → ℝ) {H : Matrix n n ℝ}
    (hH : (-H).PosDef) {x : n → ℝ} (hx : x ≠ newtonStep g H) :
    quadModel D g H x < quadModel D g H (newtonStep g H) := by
  -- `−H` symmetric ⇒ `H` symmetric (`IsSymm.neg`, `neg_neg`).
  have hsymm : H.IsSymm := by simpa using hH.isHermitian.isSymm.neg
  -- `−H` invertible ⇒ `H` invertible (`IsUnit.neg_iff`).
  have hdet : IsUnit H.det :=
    (isUnit_iff_isUnit_det H).mp ((IsUnit.neg_iff H).mp hH.isUnit)
  have hv : x - newtonStep g H ≠ 0 := sub_ne_zero.mpr hx
  -- `vᵀ(−H)v > 0`, i.e. `vᵀHv < 0` (`neg_mulVec`, `dotProduct_neg`).
  have hpos := hH.dotProduct_mulVec_pos hv
  rw [star_vec, neg_mulVec, dotProduct_neg] at hpos
  have hsplit : x = newtonStep g H + (x - newtonStep g H) := (add_sub_cancel _ _).symm
  rw [hsplit, quadModel_newtonStep_add D g hsymm hdet]
  linarith

/-! ### A concrete instance: the hypotheses are satisfiable

`H = diag(−2, −2, −2)` (a DoG maximum, negative definite) and `g = (½, 0, 0)`. Then
`x̂ = (¼, 0, 0)`, inside OpenCV's convergence box `|x̂ᵢ| < 0.5`, and the contrast is
`D + 1/16`. -/

example (D : ℝ) :
    newtonStep ![1 / 2, 0, 0] (!![-2, 0, 0; 0, -2, 0; 0, 0, -2] : Matrix (Fin 3) (Fin 3) ℝ) =
      ![1 / 4, 0, 0] ∧
    opencvContr D ![1 / 2, 0, 0] (!![-2, 0, 0; 0, -2, 0; 0, 0, -2] : Matrix (Fin 3) (Fin 3) ℝ) =
      D + 1 / 16 := by
  -- `H⁻¹ = diag(−½, −½, −½)`: Mathlib's `H⁻¹` is `det(H)⁻¹ · adj(H)` (`inv_def`), and
  -- `det_fin_three`, `adjugate_fin_three` write both out for a 3 × 3 matrix.
  have hstep :
      newtonStep ![1 / 2, 0, 0] (!![-2, 0, 0; 0, -2, 0; 0, 0, -2] : Matrix (Fin 3) (Fin 3) ℝ) =
        ![1 / 4, 0, 0] := by
    rw [newtonStep, inv_def, adjugate_fin_three]
    ext i
    fin_cases i <;> norm_num [det_fin_three, mulVec, dotProduct, Fin.sum_univ_three]
  refine ⟨hstep, ?_⟩
  -- `contr = D + (gᵀx̂)·0.5 = D + (½ · ¼)·0.5`.
  rw [opencvContr, hstep]
  norm_num [dotProduct, Fin.sum_univ_three]

end KeypointMath.SIFT
