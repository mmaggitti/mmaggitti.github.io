import Mathlib.Analysis.SpecialFunctions.Pow.Real
import Mathlib.Probability.Distributions.Gaussian.Real
import KeypointMath.SIFT.Constants

/-!
# SIFT, step 1: the scale space

Claims checked here (Keypoint Detector Math, SIFT, "Scale space"):

* inside an octave, σ grows by `k = 2^(1/S)`, so after `S` layers it has doubled;
* OpenCV's per-layer blurs `sig[i]` stack up to exactly `σᵢ = σ₀ kⁱ`;
* halving the image to start the next octave brings the blur back to exactly `σ₀`;
* the base layer, built from the input's assumed blur of 0.5, has blur exactly `σ₀`, if resizing
  adds no blur of its own (see "Not modeled" below).

## The code being checked

OpenCV 4.12, `modules/features2d/src/sift.dispatch.cpp`, `buildGaussianPyramid`:

```cpp
// precompute Gaussian sigmas using the following formula:
//  \sigma_{total}^2 = \sigma_{i}^2 + \sigma_{i-1}^2
sig[0] = sigma;
double k = std::pow( 2., 1. / nOctaveLayers );
for( int i = 1; i < nOctaveLayers + 3; i++ ) {
    double sig_prev = std::pow(k, (double)(i-1))*sigma;
    double sig_total = sig_prev*k;
    sig[i] = std::sqrt(sig_total*sig_total - sig_prev*sig_prev);
}
// layer i > 0:          GaussianBlur(layer i-1, sig[i])
// layer 0 of octave o:  layer nOctaveLayers of octave o-1, resized to half with INTER_NEAREST
```

and `createInitialImage`. OpenCV doubles the input (`firstOctave = -1`) unless it is given
keypoints whose octaves are all `≥ 0`:

```cpp
// doubled:
sig_diff = sqrtf( std::max(sigma * sigma - SIFT_INIT_SIGMA * SIFT_INIT_SIGMA * 4, 0.01f) );
// resize the input to 2x (INTER_LINEAR by default), then
// GaussianBlur(dbl, result, Size(), sig_diff, sig_diff)
// not doubled:
sig_diff = sqrtf( std::max(sigma * sigma - SIFT_INIT_SIGMA * SIFT_INIT_SIGMA, 0.01f) );
```

## Model

* A blur with standard deviation `σ` is convolution with the Gaussian `N(0, σ²)`.
* OpenCV's `GaussianBlur` is separable (rows, then columns), so one axis is enough. We use the
  1D kernel as a probability measure on `ℝ`: Mathlib's `ProbabilityTheory.gaussianReal`.
  `KeypointMath.SIFT.gauss2_eq_mul` (in `DoG.lean`) shows the 2D kernel is the product of two
  of these.
* Blurring twice convolves the two kernels: `MeasureTheory.Measure.conv`, written `∗`.
* Resizing an image by `c` maps each kernel forward along `x ↦ c·x` (`Measure.map`).

Not modeled:

* OpenCV samples and truncates each kernel, and computes in `float`. The statements below are
  about the exact Gaussians.
* Resampling. Resizing is modeled as an exact change of coordinates. OpenCV doubles the image
  with bilinear interpolation, which adds blur of its own: about 0.75 px² of variance (in the
  doubled image's pixels) with the default `INTER_LINEAR` resize, and about 0.5 px² on average
  with `enable_precise_upscale`. So, with the 0.5 assumption, the base layer's blur is about
  1.82 (or 1.75), not exactly 1.6. OpenCV halves with `INTER_NEAREST`, which adds no blur but
  aliases.
-/

namespace KeypointMath.SIFT

open MeasureTheory ProbabilityTheory
open scoped NNReal

/-- The variance `σ²` of a blur with standard deviation `σ`, packaged as the `ℝ≥0` that
`gaussianReal` takes. -/
def blurVar (σ : ℝ) : ℝ≥0 := NNReal.mk (σ ^ 2) (sq_nonneg σ)

/-- The 1D Gaussian blur kernel `N(0, σ²)`, as a probability measure on `ℝ`. -/
noncomputable def blurKernel (σ : ℝ) : Measure ℝ := gaussianReal 0 (blurVar σ)

/-- **Blurs compose by adding variances.** Blurring by `a`, then by `b`, is one blur by `c`
whenever `a² + b² = c²`. This is the formula in OpenCV's comment above. -/
theorem blurKernel_conv {a b c : ℝ} (h : a ^ 2 + b ^ 2 = c ^ 2) :
    blurKernel a ∗ blurKernel b = blurKernel c := by
  -- `gaussianReal_conv_gaussianReal`: N(m₁, v₁) ∗ N(m₂, v₂) = N(m₁ + m₂, v₁ + v₂).
  rw [blurKernel, blurKernel, gaussianReal_conv_gaussianReal, add_zero, blurKernel]
  -- Both sides are `gaussianReal 0 _`; `congr 1` leaves the two variances to compare.
  congr 1
  -- `ext` turns equality in `ℝ≥0` into equality of the underlying reals;
  -- `NNReal.coe_add` and `NNReal.coe_mk` unfold the coercion `ℝ≥0 → ℝ`.
  ext
  simpa only [blurVar, NNReal.coe_add, NNReal.coe_mk] using h

/-- **Resizing an image rescales its blur.** Pushing `N(0, σ²)` forward along `x ↦ c·x` gives
`N(0, (cσ)²)`: upscaling by 2 doubles every blur measured in pixels, and halving halves it. -/
theorem map_mul_blurKernel (c σ : ℝ) :
    (blurKernel σ).map (fun x => c * x) = blurKernel (c * σ) := by
  -- `gaussianReal_map_const_mul`: N(μ, v) mapped by `x ↦ c·x` is N(c·μ, c²·v).
  rw [blurKernel, gaussianReal_map_const_mul, mul_zero, blurKernel]
  congr 1
  ext
  simp only [blurVar, NNReal.coe_mul, NNReal.coe_mk]
  ring

/-- The scale step between layers, `k = 2^(1/S)`, where `S = nOctaveLayers`. -/
noncomputable def scaleStep (S : ℕ) : ℝ := (2 : ℝ) ^ ((S : ℝ)⁻¹)

/-- **`k^S = 2`:** after `S` layers the blur has doubled. -/
theorem scaleStep_pow {S : ℕ} (hS : S ≠ 0) : scaleStep S ^ S = 2 :=
  -- `Real.rpow_inv_natCast_pow`: `(x ^ (n⁻¹ : ℝ)) ^ n = x` for `0 ≤ x` and `n ≠ 0`.
  Real.rpow_inv_natCast_pow (by norm_num) hS

/-- `k ≥ 1`, so σ never shrinks from one layer to the next. -/
theorem one_le_scaleStep (S : ℕ) : 1 ≤ scaleStep S :=
  -- `Real.one_le_rpow`: `1 ≤ x → 0 ≤ z → 1 ≤ x ^ z`; `positivity` proves `0 ≤ (S : ℝ)⁻¹`.
  Real.one_le_rpow (by norm_num) (by positivity)

/-- Total blur of layer `i` in an octave, `σᵢ = σ₀ kⁱ`, in that octave's pixels. -/
noncomputable def layerSigma (σ₀ : ℝ) (S i : ℕ) : ℝ := σ₀ * scaleStep S ^ i

/-- `σᵢ₊₁ = k σᵢ`: neighbouring layers differ by the factor `k`. -/
theorem layerSigma_succ (σ₀ : ℝ) (S i : ℕ) :
    layerSigma σ₀ S (i + 1) = scaleStep S * layerSigma σ₀ S i := by
  rw [layerSigma, layerSigma, pow_succ]
  ring

/-- Layer `i + S` has twice the blur of layer `i`. -/
theorem layerSigma_add {S : ℕ} (hS : S ≠ 0) (σ₀ : ℝ) (i : ℕ) :
    layerSigma σ₀ S (i + S) = 2 * layerSigma σ₀ S i := by
  -- `pow_add`: `k ^ (i + S) = k ^ i * k ^ S`; then `k ^ S = 2`; `ring` tidies the product.
  rw [layerSigma, layerSigma, pow_add, scaleStep_pow hS]
  ring

/-- OpenCV's `sig[i + 1]`: the extra blur that takes layer `i` to layer `i + 1`. -/
noncomputable def incSigma (σ₀ : ℝ) (S i : ℕ) : ℝ :=
  Real.sqrt (layerSigma σ₀ S (i + 1) ^ 2 - layerSigma σ₀ S i ^ 2)

/-- `incSigma` is OpenCV's expression term for term, with `sig_prev = kⁱ σ₀` and
`sig_total = sig_prev · k`. -/
theorem incSigma_eq_opencv (σ₀ : ℝ) (S i : ℕ) :
    incSigma σ₀ S i =
      let sig_prev := scaleStep S ^ i * σ₀
      let sig_total := sig_prev * scaleStep S
      Real.sqrt (sig_total * sig_total - sig_prev * sig_prev) := by
  -- `pow_succ`: `k ^ (i + 1) = k ^ i * k`; the two radicands then agree by `ring`.
  simp only [incSigma, layerSigma, pow_succ]
  ring_nf

/-- The radicand in `incSigma` is `σᵢ₊₁² − σᵢ²`, so adding the variances gives `σᵢ₊₁²`. -/
theorem layerSigma_sq_add_incSigma_sq {σ₀ : ℝ} (hσ₀ : 0 ≤ σ₀) (S i : ℕ) :
    layerSigma σ₀ S i ^ 2 + incSigma σ₀ S i ^ 2 = layerSigma σ₀ S (i + 1) ^ 2 := by
  have hk := one_le_scaleStep S
  have hpow : 0 ≤ scaleStep S ^ i := pow_nonneg (by linarith) i
  have h0 : 0 ≤ layerSigma σ₀ S i := mul_nonneg hσ₀ hpow
  -- σᵢ ≤ σᵢ₊₁, since σᵢ₊₁ = σᵢ · k and k ≥ 1.
  have hle : layerSigma σ₀ S i ≤ layerSigma σ₀ S (i + 1) := by
    rw [layerSigma_succ, mul_comm]
    -- `le_mul_of_one_le_right`: `0 ≤ b → 1 ≤ a → b ≤ b * a`.
    exact le_mul_of_one_le_right h0 hk
  -- So the radicand is ≥ 0 (`nlinarith` multiplies the two inequalities above).
  have hrad : 0 ≤ layerSigma σ₀ S (i + 1) ^ 2 - layerSigma σ₀ S i ^ 2 := by nlinarith
  -- `Real.sq_sqrt`: `0 ≤ a → √a ^ 2 = a`.
  rw [incSigma, Real.sq_sqrt hrad]
  ring

/-- The kernel of layer `i`, built the way OpenCV builds it: start from the base blur `σ₀`, then
blur by `sig[1]`, `sig[2]`, …, one layer at a time. -/
noncomputable def pyramidKernel (σ₀ : ℝ) (S : ℕ) : ℕ → Measure ℝ
  | 0 => blurKernel σ₀
  | i + 1 => pyramidKernel σ₀ S i ∗ blurKernel (incSigma σ₀ S i)

/-- **OpenCV's incremental blurs land exactly on `σᵢ = σ₀ kⁱ`.** After `i` steps, the
accumulated kernel is the single Gaussian `N(0, (σ₀ kⁱ)²)`. -/
theorem pyramidKernel_eq {σ₀ : ℝ} (hσ₀ : 0 ≤ σ₀) (S : ℕ) :
    ∀ i, pyramidKernel σ₀ S i = blurKernel (layerSigma σ₀ S i)
  | 0 => by simp [pyramidKernel, layerSigma]
  | i + 1 => by
      -- Induction on the layer: the previous layer is `N(0, σᵢ²)`, and one more blur by
      -- `sig[i+1]` adds its variance, giving `N(0, σᵢ₊₁²)` by `blurKernel_conv`.
      rw [pyramidKernel, pyramidKernel_eq hσ₀ S i]
      exact blurKernel_conv (layerSigma_sq_add_incSigma_sq hσ₀ S i)

/-- **Each octave starts where the last one left off.** Layer `S` of an octave has blur `2σ₀`.
OpenCV halves that image (`INTER_NEAREST`) to start the next octave, and halving the
coordinates turns `N(0, (2σ₀)²)` into `N(0, σ₀²)`: exactly the base blur again. -/
theorem octave_handoff {S : ℕ} (hS : S ≠ 0) {σ₀ : ℝ} (hσ₀ : 0 ≤ σ₀) :
    (pyramidKernel σ₀ S S).map (fun x => (1 / 2 : ℝ) * x) = pyramidKernel σ₀ S 0 := by
  rw [pyramidKernel_eq hσ₀, map_mul_blurKernel, pyramidKernel]
  congr 1
  -- `layerSigma_add` with `i = 0`: σ_S = 2 σ₀.
  have h := layerSigma_add hS σ₀ 0
  rw [zero_add] at h
  rw [h, layerSigma]
  ring

open OpenCV in
/-- **The base layer has blur exactly `σ₀`, for an interpolation-free upscale.** OpenCV assumes
the input has blur `SIFT_INIT_SIGMA = 0.5`. It upscales the input 2×, which doubles that blur to
`2 · 0.5 = 1`, then blurs by `sig_diff = √(max(σ₀² − 0.5² · 4, 0.01))`. When `σ₀² − 1 ≥ 0.01`
the result is exactly `N(0, σ₀²)`. OpenCV's bilinear upscale adds blur that this model omits
(see "Not modeled" above). -/
theorem base_blur {σ₀ : ℝ} (hσ₀ : 0.01 ≤ σ₀ * σ₀ - SIFT_INIT_SIGMA * SIFT_INIT_SIGMA * 4) :
    (blurKernel SIFT_INIT_SIGMA).map (fun x => 2 * x) ∗
        blurKernel (Real.sqrt (max (σ₀ * σ₀ - SIFT_INIT_SIGMA * SIFT_INIT_SIGMA * 4) 0.01)) =
      blurKernel σ₀ := by
  rw [map_mul_blurKernel]
  apply blurKernel_conv
  -- `max_eq_left`: the `0.01` floor is inactive; `Real.sq_sqrt` removes the root.
  rw [max_eq_left hσ₀, Real.sq_sqrt (by linarith)]
  ring

open OpenCV in
/-- **Without the upscale, the base layer also has blur exactly `σ₀`.** OpenCV skips the 2×
upscale only when it is given keypoints whose octaves are all `≥ 0`. It then blurs the input by
`√(max(σ₀² − 0.5², 0.01))`. No resampling is involved, so this case is exact in the model. -/
theorem base_blur_no_upscale {σ₀ : ℝ} (hσ₀ : 0.01 ≤ σ₀ * σ₀ - SIFT_INIT_SIGMA * SIFT_INIT_SIGMA) :
    blurKernel SIFT_INIT_SIGMA ∗
        blurKernel (Real.sqrt (max (σ₀ * σ₀ - SIFT_INIT_SIGMA * SIFT_INIT_SIGMA) 0.01)) =
      blurKernel σ₀ := by
  apply blurKernel_conv
  rw [max_eq_left hσ₀, Real.sq_sqrt (by linarith)]
  ring

/-! ### OpenCV's defaults: `sigma = 1.6`, `nOctaveLayers = 3` -/

open OpenCV in
/-- With `S = 3`, `k = 2^(1/3)` and `k³ = 2`. -/
example : scaleStep nOctaveLayers ^ nOctaveLayers = 2 :=
  scaleStep_pow (by norm_num [nOctaveLayers])

open OpenCV in
/-- With the defaults, the next octave starts at exactly `σ₀ = 1.6`. -/
example :
    (pyramidKernel sigma nOctaveLayers nOctaveLayers).map (fun x => (1 / 2 : ℝ) * x) =
      pyramidKernel sigma nOctaveLayers 0 :=
  octave_handoff (by norm_num [nOctaveLayers]) (by norm_num [sigma])

open OpenCV in
/-- With the defaults, `σ₀² − 1 = 1.56 ≥ 0.01`, so the base layer is exactly `N(0, 1.6²)` in the
model. -/
example :
    (blurKernel SIFT_INIT_SIGMA).map (fun x => 2 * x) ∗
        blurKernel (Real.sqrt (max (sigma * sigma - SIFT_INIT_SIGMA * SIFT_INIT_SIGMA * 4) 0.01)) =
      blurKernel sigma :=
  base_blur (by norm_num [sigma, SIFT_INIT_SIGMA])

end KeypointMath.SIFT
