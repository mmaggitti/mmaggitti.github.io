import Mathlib.Analysis.SpecialFunctions.ExpDeriv
import Mathlib.Analysis.Calculus.Deriv.Slope
import Mathlib.Analysis.SpecialFunctions.Pow.Continuity
import KeypointMath.SIFT.ScaleSpace

/-!
# SIFT, step 2: the Difference of Gaussians approximates σ²∇²G

Claims checked here (Keypoint Detector Math, SIFT, "Response"):

* the heat equation for the Gaussian, `∂G/∂σ = σ∇²G`;
* `D = G(kσ) − G(σ) ≈ (k − 1) σ²∇²G`: the DoG divided by `k − 1` tends to the
  scale-normalized Laplacian `σ²∇²G` as `k → 1`. With OpenCV's step `k = 2^(1/S)`, that is the
  limit as the number of layers per octave `S` grows (`dog_div_tendsto_layers`);
* for `k > 1` the DoG kernel takes its least value, which is negative, at its centre
  (`dog_center_min`, `dog_center_neg`). So a bright point gives a DoG minimum at its own
  position.

The 2D kernel is also shown to be the product of two 1D `N(0, σ²)` densities
(`gauss2_eq_mul`). That is the separability the scale-space file relies on.

## The code being checked

OpenCV 4.12, `modules/features2d/src/sift.dispatch.cpp`, `buildDoGPyramid`:

```cpp
const Mat& src1 = gpyr[o*(nOctaveLayers + 3) + i];
const Mat& src2 = gpyr[o*(nOctaveLayers + 3) + i + 1];
subtract(src2, src1, dst, noArray(), DataType<sift_wt>::type);   // D = L(kσ) − L(σ)
```

Not modeled:

* The image response `D ∗ I`. All statements here are about the kernel `G`, as agreed for this
  pass. Carrying the limit through the convolution needs differentiation under the integral,
  which is not done here. For the same reason, that a bright blob of finite size gives a DoG
  minimum is the usual reading, but it is not proven here.
* OpenCV's sampled and truncated kernels, and `float` arithmetic.

## Notation

* `gauss2 σ x y` is `G(x, y, σ) = exp(−(x² + y²)/(2σ²)) / (2πσ²)`.
* `laplacian2 f x y` is `∂²f/∂x² + ∂²f/∂y²`. Each second partial is Mathlib's one-variable
  `deriv`, applied twice along one axis with the other coordinate held fixed.
-/

namespace KeypointMath.SIFT

open Real Filter Topology ProbabilityTheory

/-- The 2D Gaussian kernel `G(x, y, σ) = exp(−(x² + y²)/(2σ²)) / (2πσ²)`. -/
noncomputable def gauss2 (σ x y : ℝ) : ℝ :=
  exp (-(x ^ 2 + y ^ 2) / (2 * σ ^ 2)) / (2 * π * σ ^ 2)

/-- The 2D Laplacian `∇²f = ∂²f/∂x² + ∂²f/∂y²`, each second partial taken with `deriv` along one
axis while the other coordinate is held fixed. -/
noncomputable def laplacian2 (f : ℝ → ℝ → ℝ) (x y : ℝ) : ℝ :=
  deriv (deriv fun u => f u y) x + deriv (deriv fun v => f x v) y

/-! ### First and second partials in `x` and `y` -/

/-- `∂G/∂x = G · (−x/σ²)`. -/
theorem hasDerivAt_gauss2_x (σ x y : ℝ) :
    HasDerivAt (fun u => gauss2 σ u y) (gauss2 σ x y * (-x / σ ^ 2)) x := by
  -- The exponent `u ↦ −(u² + y²)/(2σ²)` has derivative `−(2u)/(2σ²)`:
  -- `hasDerivAt_pow`, then `.add_const`, `.neg` and `.div_const` build it up.
  have hexp : HasDerivAt (fun u => -(u ^ 2 + y ^ 2) / (2 * σ ^ 2)) (-(2 * x) / (2 * σ ^ 2)) x := by
    have h := (((hasDerivAt_pow 2 x).add_const (y ^ 2)).neg).div_const (2 * σ ^ 2)
    simpa using h
  -- `HasDerivAt.exp` is the chain rule for `exp`; `.div_const` divides by `2πσ²`.
  have h := hexp.exp.div_const (2 * π * σ ^ 2)
  -- `unfold` exposes the formula, so the two functions match syntactically.
  -- `convert … using 1` then leaves only the two derivative values to compare;
  -- `ring` proves that (it handles `⁻¹` of products, so no `σ ≠ 0` is needed here).
  unfold gauss2
  convert h using 1
  ring

/-- `∂G/∂y = G · (−y/σ²)`. -/
theorem hasDerivAt_gauss2_y (σ x y : ℝ) :
    HasDerivAt (fun v => gauss2 σ x v) (gauss2 σ x y * (-y / σ ^ 2)) y := by
  have hexp : HasDerivAt (fun v => -(x ^ 2 + v ^ 2) / (2 * σ ^ 2)) (-(2 * y) / (2 * σ ^ 2)) y := by
    have h := (((hasDerivAt_pow 2 y).const_add (x ^ 2)).neg).div_const (2 * σ ^ 2)
    simpa using h
  have h := hexp.exp.div_const (2 * π * σ ^ 2)
  unfold gauss2
  convert h using 1
  ring

/-- The first partial in `x`, as a function: `∂G/∂x (u) = G(u, y, σ) · (−u/σ²)`. -/
theorem deriv_gauss2_x (σ y : ℝ) :
    deriv (fun u => gauss2 σ u y) = fun u => gauss2 σ u y * (-u / σ ^ 2) :=
  -- `HasDerivAt.deriv` turns a `HasDerivAt` fact into a value of `deriv`.
  funext fun u => (hasDerivAt_gauss2_x σ u y).deriv

/-- The first partial in `y`, as a function. -/
theorem deriv_gauss2_y (σ x : ℝ) :
    deriv (fun v => gauss2 σ x v) = fun v => gauss2 σ x v * (-v / σ ^ 2) :=
  funext fun v => (hasDerivAt_gauss2_y σ x v).deriv

/-- `∂²G/∂x² = G · (x²/σ⁴ − 1/σ²)`. -/
theorem deriv2_gauss2_x (σ x y : ℝ) :
    deriv (deriv fun u => gauss2 σ u y) x = gauss2 σ x y * (x ^ 2 / σ ^ 4 - 1 / σ ^ 2) := by
  rw [deriv_gauss2_x]
  -- Product rule on `G · (−u/σ²)`: `HasDerivAt.fun_mul` is the form for `fun u => f u * g u`;
  -- `hasDerivAt_id'` is `u ↦ u` with derivative 1.
  have h := (hasDerivAt_gauss2_x σ x y).fun_mul ((hasDerivAt_id' x).neg.div_const (σ ^ 2))
  have h' : HasDerivAt (fun u => gauss2 σ u y * (-u / σ ^ 2))
      (gauss2 σ x y * (x ^ 2 / σ ^ 4 - 1 / σ ^ 2)) x := by
    convert h using 1
    -- `.neg` wrote `−u` as the pointwise negation `(-fun x => x) u`; `Pi.neg_apply` unfolds it.
    simp only [Pi.neg_apply]
    ring
  exact h'.deriv

/-- `∂²G/∂y² = G · (y²/σ⁴ − 1/σ²)`. -/
theorem deriv2_gauss2_y (σ x y : ℝ) :
    deriv (deriv fun v => gauss2 σ x v) y = gauss2 σ x y * (y ^ 2 / σ ^ 4 - 1 / σ ^ 2) := by
  rw [deriv_gauss2_y]
  have h := (hasDerivAt_gauss2_y σ x y).fun_mul ((hasDerivAt_id' y).neg.div_const (σ ^ 2))
  have h' : HasDerivAt (fun v => gauss2 σ x v * (-v / σ ^ 2))
      (gauss2 σ x y * (y ^ 2 / σ ^ 4 - 1 / σ ^ 2)) y := by
    convert h using 1
    -- `.neg` wrote `−u` as the pointwise negation `(-fun x => x) u`; `Pi.neg_apply` unfolds it.
    simp only [Pi.neg_apply]
    ring
  exact h'.deriv

/-- `∇²G = G · ((x² + y²)/σ⁴ − 2/σ²)`. -/
theorem laplacian2_gauss2 (σ x y : ℝ) :
    laplacian2 (gauss2 σ) x y = gauss2 σ x y * ((x ^ 2 + y ^ 2) / σ ^ 4 - 2 / σ ^ 2) := by
  rw [laplacian2, deriv2_gauss2_x, deriv2_gauss2_y]
  ring

/-! ### The derivative in `σ` and the heat equation -/

/-- `∂G/∂σ = G · ((x² + y²)/σ³ − 2/σ)`, for `σ ≠ 0`. -/
theorem hasDerivAt_gauss2_σ (x y : ℝ) {σ : ℝ} (hσ : σ ≠ 0) :
    HasDerivAt (fun s => gauss2 s x y) (gauss2 σ x y * ((x ^ 2 + y ^ 2) / σ ^ 3 - 2 / σ)) σ := by
  have hπ : π ≠ 0 := pi_ne_zero
  -- `s ↦ 2s²` has derivative `2 · (2σ)` (`hasDerivAt_pow`, then `.const_mul`).
  have hsq : HasDerivAt (fun s => 2 * s ^ 2) (2 * ((2 : ℕ) * σ ^ (2 - 1))) σ :=
    (hasDerivAt_pow 2 σ).const_mul 2
  -- The exponent `s ↦ −(x² + y²)/(2s²)`: quotient rule `HasDerivAt.fun_div` of a constant.
  have hexp := (hasDerivAt_const σ (-(x ^ 2 + y ^ 2))).fun_div hsq (by positivity)
  -- The normalizer `s ↦ 2πs²`.
  have hnorm : HasDerivAt (fun s => 2 * π * s ^ 2) (2 * π * ((2 : ℕ) * σ ^ (2 - 1))) σ :=
    (hasDerivAt_pow 2 σ).const_mul (2 * π)
  -- Chain rule for `exp`, then the quotient rule for `exp(…) / (2πs²)`.
  have h := hexp.exp.fun_div hnorm (by positivity)
  unfold gauss2
  convert h using 1
  -- `norm_num` turns `((2 : ℕ) : ℝ) * σ ^ (2 - 1)` into `2 * σ`; `field_simp` clears the
  -- denominators (using `σ ≠ 0` and `π ≠ 0`); `ring` closes what is left.
  norm_num
  field_simp
  ring

/-- **The heat equation for the Gaussian: `∂G/∂σ = σ ∇²G`.** -/
theorem gauss2_heat (x y : ℝ) {σ : ℝ} (hσ : σ ≠ 0) :
    deriv (fun s => gauss2 s x y) σ = σ * laplacian2 (gauss2 σ) x y := by
  rw [(hasDerivAt_gauss2_σ x y hσ).deriv, laplacian2_gauss2]
  -- `field_simp` clears the denominators `σ`, `σ³`, `σ⁴` (using `hσ`) and closes the goal.
  field_simp

/-- **DoG ≈ (k − 1)σ²∇²G.** The Difference of Gaussians with scale ratio `k`, divided by `k − 1`,
tends to the scale-normalized Laplacian `σ²∇²G` as `k → 1` with `k ≠ 1`.

Read as: `G(x, y, kσ) − G(x, y, σ) = (k − 1)·σ²∇²G(x, y, σ) + o(k − 1)`.
OpenCV's `k = 2^(1/3) ≈ 1.26` is a fixed step, not a limit; this theorem is the precise sense in
which "≈" holds. The factor `k − 1` is the same at every scale, which is why it does not move
the extrema. -/
theorem dog_div_tendsto (x y : ℝ) {σ : ℝ} (hσ : σ ≠ 0) :
    Tendsto (fun k => (gauss2 (k * σ) x y - gauss2 σ x y) / (k - 1)) (𝓝[≠] 1)
      (𝓝 (σ ^ 2 * laplacian2 (gauss2 σ) x y)) := by
  -- `k ↦ kσ` has derivative `σ` at `k = 1`.
  have hk : HasDerivAt (fun k : ℝ => k * σ) σ 1 := by
    simpa using (hasDerivAt_id (1 : ℝ)).mul_const σ
  -- `∂G/∂σ` at `1 · σ = σ`.
  have hG : HasDerivAt (fun s => gauss2 s x y)
      (gauss2 σ x y * ((x ^ 2 + y ^ 2) / σ ^ 3 - 2 / σ)) (1 * σ) := by
    rw [one_mul]
    exact hasDerivAt_gauss2_σ x y hσ
  -- Chain rule (`HasDerivAt.comp`): `k ↦ G(x, y, kσ)` has derivative `(∂G/∂σ)(σ) · σ` at 1.
  have hcomp := hG.comp 1 hk
  -- `hasDerivAt_iff_tendsto_slope`: a derivative is the limit of difference quotients
  -- (`slope f a b = (f b − f a)/(b − a)`) along `𝓝[≠] a`.
  have hslope := hasDerivAt_iff_tendsto_slope.mp hcomp
  -- The limit value is `σ²∇²G`.
  have hval : gauss2 σ x y * ((x ^ 2 + y ^ 2) / σ ^ 3 - 2 / σ) * σ =
      σ ^ 2 * laplacian2 (gauss2 σ) x y := by
    rw [laplacian2_gauss2]
    field_simp
  rw [hval] at hslope
  -- The difference quotient is our expression, pointwise (`Tendsto.congr`).
  refine hslope.congr fun k => ?_
  simp only [slope_def_field, Function.comp_apply, one_mul]

/-- **The DoG kernel is negative at its centre** for `k > 1`: `G(0, 0, kσ) < G(0, 0, σ)`.
OpenCV computes `D = L(kσ) − L(σ)`, so a bright point gives a negative response at its own
position. -/
theorem dog_center_neg {σ k : ℝ} (hσ : σ ≠ 0) (hk : 1 < k) :
    gauss2 (k * σ) 0 0 - gauss2 σ 0 0 < 0 := by
  have hσ2 : 0 < σ ^ 2 := by positivity
  have hk2 : 1 < k ^ 2 := by nlinarith
  -- At the origin `exp 0 = 1`, so `G(0, 0, s) = 1/(2πs²)`, and `1/x` falls as `x` grows
  -- (`one_div_lt_one_div_of_lt`).
  have hden : 2 * π * σ ^ 2 < 2 * π * (k * σ) ^ 2 := by
    -- `σ² < k²σ²` because `(k² − 1)σ² > 0`; then multiply by `2π > 0` (`mul_lt_mul_of_pos_left`).
    have h1 : σ ^ 2 < k ^ 2 * σ ^ 2 := by nlinarith [mul_pos (sub_pos.mpr hk2) hσ2]
    rw [mul_pow]
    exact mul_lt_mul_of_pos_left h1 (by positivity)
  have h := one_div_lt_one_div_of_lt (by positivity) hden
  simp only [gauss2]
  norm_num
  simpa [one_div] using h

/-- **The DoG kernel takes its least value at its centre** for `k > 1`:
`G(0, 0, kσ) − G(0, 0, σ) ≤ G(x, y, kσ) − G(x, y, σ)` for every `(x, y)`. With `dog_center_neg`,
a bright point gives a negative DoG minimum at its own position. -/
theorem dog_center_min {σ k : ℝ} (hσ : σ ≠ 0) (hk : 1 < k) (x y : ℝ) :
    gauss2 (k * σ) 0 0 - gauss2 σ 0 0 ≤ gauss2 (k * σ) x y - gauss2 σ x y := by
  -- Write `u = x² + y²`, `B = 2πσ²` and `A = 2π(kσ)²`, so `B ≤ A`. The claim is
  -- `(1 − e^(−u/(2(kσ)²)))/A ≤ (1 − e^(−u/(2σ²)))/B`: a smaller numerator over a larger
  -- denominator.
  have hσ2 : 0 < σ ^ 2 := by positivity
  have hk2 : 1 < k ^ 2 := by nlinarith
  have hu : 0 ≤ x ^ 2 + y ^ 2 := by positivity
  have hP : 0 < 2 * π * σ ^ 2 := by positivity
  have hPQ : 2 * π * σ ^ 2 ≤ 2 * π * (k * σ) ^ 2 := by
    rw [mul_pow]; nlinarith [mul_pos (sub_pos.mpr hk2) hσ2, pi_pos]
  -- `u/(2σ²) ≥ u/(2(kσ)²)` (`div_le_div_of_nonneg_left`: `a/b ≤ a/c` for `0 ≤ a`, `c ≤ b`).
  have hexp : -(x ^ 2 + y ^ 2) / (2 * σ ^ 2) ≤ -(x ^ 2 + y ^ 2) / (2 * (k * σ) ^ 2) := by
    rw [neg_div, neg_div, neg_le_neg_iff]
    apply div_le_div_of_nonneg_left hu (by positivity)
    rw [mul_pow]; nlinarith [mul_pos (sub_pos.mpr hk2) hσ2]
  -- `exp` is monotone (`Real.exp_le_exp`), and `exp t ≤ 1` for `t ≤ 0` (`Real.exp_le_one_iff`).
  have hE : exp (-(x ^ 2 + y ^ 2) / (2 * σ ^ 2)) ≤ exp (-(x ^ 2 + y ^ 2) / (2 * (k * σ) ^ 2)) :=
    exp_le_exp.mpr hexp
  have hE2 : exp (-(x ^ 2 + y ^ 2) / (2 * (k * σ) ^ 2)) ≤ 1 := by
    rw [exp_le_one_iff]
    exact div_nonpos_of_nonpos_of_nonneg (by linarith) (by positivity)
  -- First enlarge `1/A` to `1/B`, then the numerator (`gcongr`).
  have key : (1 - exp (-(x ^ 2 + y ^ 2) / (2 * (k * σ) ^ 2))) / (2 * π * (k * σ) ^ 2) ≤
      (1 - exp (-(x ^ 2 + y ^ 2) / (2 * σ ^ 2))) / (2 * π * σ ^ 2) := by
    calc _ ≤ (1 - exp (-(x ^ 2 + y ^ 2) / (2 * (k * σ) ^ 2))) / (2 * π * σ ^ 2) := by
          apply div_le_div_of_nonneg_left (by linarith) hP hPQ
      _ ≤ _ := by gcongr
  rw [sub_div, sub_div] at key
  -- At the origin `exp 0 = 1`, so `G(0, 0, s) = 1/(2πs²)`.
  have h0 : ∀ s : ℝ, gauss2 s 0 0 = 1 / (2 * π * s ^ 2) := by
    intro s; simp [gauss2]
  rw [h0, h0]
  simp only [gauss2]
  linarith

/-- **OpenCV's step `k = 2^(1/S)` tends to 1 as the number of layers `S` grows**, and it is
never 1 for `S ≥ 1`. -/
theorem tendsto_scaleStep : Tendsto scaleStep atTop (𝓝[≠] 1) := by
  -- `tendsto_nhdsWithin_iff`: tend to 1 in `ℝ`, and eventually avoid 1.
  rw [tendsto_nhdsWithin_iff]
  constructor
  · -- `(S : ℝ)⁻¹ → 0` (`tendsto_natCast_atTop_atTop`, `tendsto_inv_atTop_zero`), and
    -- `y ↦ 2^y` is continuous at 0 (`Real.continuousAt_const_rpow`), with `2^0 = 1`.
    have h0 : Tendsto (fun S : ℕ => ((S : ℝ))⁻¹) atTop (𝓝 0) :=
      tendsto_inv_atTop_zero.comp tendsto_natCast_atTop_atTop
    have h := (Real.continuousAt_const_rpow (a := 2) (b := 0) two_ne_zero).tendsto.comp h0
    have h' : Tendsto (fun S : ℕ => (2 : ℝ) ^ ((S : ℝ))⁻¹) atTop (𝓝 1) := by
      simpa [Function.comp_def] using h
    -- `scaleStep` is by definition `fun S => 2 ^ (S : ℝ)⁻¹`.
    exact h'
  · -- For `S ≥ 1`, `1/S > 0`, so `2^(1/S) > 1` (`Real.one_lt_rpow`).
    filter_upwards [eventually_ge_atTop 1] with S hS
    have hpos : (0 : ℝ) < (S : ℝ)⁻¹ := inv_pos.mpr (Nat.cast_pos.mpr hS)
    exact (Real.one_lt_rpow (by norm_num) hpos).ne'

/-- **With OpenCV's step `k = 2^(1/S)`, the DoG divided by `k − 1` tends to `σ²∇²G` as the
number of layers per octave `S` grows.** For example, layer 1 of an octave has blur `k σ₀`
(`layerSigma_succ`), so the DoG between layers 0 and 1 is the numerator of this expression, with
`σ = σ₀`. This is a limit; it gives no error bound at OpenCV's `S = 3`. -/
theorem dog_div_tendsto_layers (x y : ℝ) {σ : ℝ} (hσ : σ ≠ 0) :
    Tendsto (fun S : ℕ => (gauss2 (scaleStep S * σ) x y - gauss2 σ x y) / (scaleStep S - 1))
      atTop (𝓝 (σ ^ 2 * laplacian2 (gauss2 σ) x y)) :=
  -- Compose the limit in `k` with `k = scaleStep S → 1` (`Tendsto.comp`).
  (dog_div_tendsto x y hσ).comp tendsto_scaleStep

/-! ### Separability -/

/-- **The 2D kernel is separable:** `G(x, y, σ) = g(x)·g(y)`, where `g` is the `N(0, σ²)`
density (`ProbabilityTheory.gaussianPDFReal`). So a 2D blur is a 1D blur along rows followed by
one along columns, as OpenCV's `GaussianBlur` does it, and the 1D kernel statements in
`ScaleSpace.lean` apply on each axis. -/
theorem gauss2_eq_mul (x y : ℝ) {σ : ℝ} (hσ : σ ≠ 0) :
    gauss2 σ x y = gaussianPDFReal 0 (blurVar σ) x * gaussianPDFReal 0 (blurVar σ) y := by
  simp only [gauss2, gaussianPDFReal, blurVar, NNReal.coe_mk, sub_zero]
  have hpos : 0 < 2 * π * σ ^ 2 := by positivity
  -- `Real.mul_self_sqrt`: `0 ≤ a → √a * √a = a`, so the two normalizers multiply to `2πσ²`.
  have hroot : √(2 * π * σ ^ 2) * √(2 * π * σ ^ 2) = 2 * π * σ ^ 2 :=
    Real.mul_self_sqrt hpos.le
  -- Group the factors so the two exponentials meet (`Real.exp_add`).
  calc exp (-(x ^ 2 + y ^ 2) / (2 * σ ^ 2)) / (2 * π * σ ^ 2)
      = (√(2 * π * σ ^ 2) * √(2 * π * σ ^ 2))⁻¹ *
          exp (-x ^ 2 / (2 * σ ^ 2) + -y ^ 2 / (2 * σ ^ 2)) := by
        rw [hroot, div_eq_inv_mul]
        congr 2
        ring
    _ = (√(2 * π * σ ^ 2))⁻¹ * exp (-x ^ 2 / (2 * σ ^ 2)) *
          ((√(2 * π * σ ^ 2))⁻¹ * exp (-y ^ 2 / (2 * σ ^ 2))) := by
        rw [Real.exp_add, mul_inv]
        ring

end KeypointMath.SIFT
