# Keypoint detector math, checked in Lean 4

Machine-checked proofs of the math behind keypoint detectors, as OpenCV 4.12 implements them.
The proofs use Lean 4 and Mathlib.

- **SIFT: done.** 9 files, 104 theorems. No `sorry`. Only Lean's three standard axioms.
- SURF, ORB, BRISK and AKAZE: not started.

## Scope

- Everything is over the exact real numbers. Nothing here models `float` rounding.
- Theorems are stated for general parameters. Where OpenCV has a default (`sigma = 1.6`,
  `nOctaveLayers = 3`, `contrastThreshold = 0.04`, `edgeThreshold = 10`), an `example` or a
  theorem applies it.
- The DoG statements are about the kernel `G`, not about the filtered image `D ∗ I`.
- Each step file opens with three things: the claims it checks, the OpenCV code it checks them
  against, and a **Not modeled** list. Read that list before you rely on a theorem.
  (`Constants.lean` is a table of constants, so it has no such list.)
- Comments name the main Mathlib lemmas that a proof uses and say what they state.

## What is proved for SIFT

All files are in `KeypointMath/SIFT/`.

| Step | File | Main results |
|---|---|---|
| 1. Scale space | `ScaleSpace.lean` | Blurs add variances (`blurKernel_conv`). `k = 2^(1/S)` doubles σ after `S` layers (`scaleStep_pow`). OpenCV's per-layer blurs `sig[i]` stack to exactly `σ₀kⁱ` (`incSigma_eq_opencv`, `pyramidKernel_eq`). Halving layer `S` gives back `σ₀` (`octave_handoff`). The base layer has blur `σ₀` if the 2× upscale adds no blur (`base_blur`); without the upscale it is exact (`base_blur_no_upscale`). |
| 2. DoG ≈ σ²∇²G | `DoG.lean` | The heat equation `∂G/∂σ = σ∇²G` (`gauss2_heat`). `(G(kσ) − G(σ))/(k − 1) → σ²∇²G` as `k → 1` (`dog_div_tendsto`), and so as `S → ∞` with `k = 2^(1/S)` (`dog_div_tendsto_layers`). The DoG kernel takes its least value, which is negative, at its centre (`dog_center_min`, `dog_center_neg`). The 2D kernel is separable (`gauss2_eq_mul`). |
| 3. Extrema | `Extrema.lean` | OpenCV's candidate test: non-strict, sign-checked, with a raw pre-threshold (`opencvCandidate_iff`, `opencvCandidate_pos`, `opencvCandidate_neg`, `opencvCandidate_plateau`). The pre-threshold is 1/255 by default (`candidateThreshold_default`) and at most half the final one (`candidateThreshold_le`). |
| 4–5. Sub-pixel fit, contrast | `SubpixelFit.lean` | `x̂ = −H⁻¹∇D` is the only stationary point of the quadratic model (`isStationary_iff`). It is the minimum or maximum when `H` is definite (`quadModel_newtonStep_lt_of_posDef`, `quadModel_lt_newtonStep_of_negDef`). OpenCV's `contr` is the model's value there (`opencvContr_eq`), and its contrast test thresholds that value (`opencv_contrast_reject_iff`). |
| 6. Edge test | `EdgeTest.lean` | `eigHi`, `eigLo` are exactly the Hessian's eigenvalues (`isEigenvalue_iff`). `Tr²/Det = (r + 1)²/r` (`trace_sq_div_det_hess2`). OpenCV keeps a point exactly when both eigenvalues have the same sign and their magnitude ratio is below `edgeThreshold` (`opencv_edge_keep_iff`). |
| 7. Orientation peak | `OrientationPeak.lean` | OpenCV's offset `½(l − r)/(l − 2c + r)` is the parabola's maximum (`parabola_le_peak`), stays within half a bin (`abs_peakOffset_lt`), and does not move when the histogram is scaled (`peakOffset_mul`). |
| 8. Descriptor bins | `Descriptor.lean` | OpenCV's chain of splits is trilinear interpolation (`opencvSplat_eq`). The 8 weights are `≥ 0`, sum to 1, and keep the sample's mean position (`triWeight_nonneg`, `triWeight_sum`, `triWeight_mean_row`). |
| 9. Normalization | `Normalization.lean` | OpenCV's one clip at `0.2‖v‖` equals Lowe's normalize–clip–normalize (`opencvNormalize_eq_siftNormalize`). The output has length 1, keeps the order of entries, and only shrinks ratios (`l2norm_siftNormalize`, `siftNormalize_order_ratio`). At a fixed keypoint the descriptor ignores `I ↦ a·I + b`, `a > 0` (`descriptor_affine_invariant`). |
| Constants | `Constants.lean` | OpenCV's constants. The default contrast test rejects a point when `D(x̂)` is below 1/75 in absolute value (`contrastReject_iff`, `default_threshold`), less than half of Lowe's 0.03 (`default_lt_half_lowe`). `contrastThreshold = 0.09` gives Lowe's final contrast test (`lowe_setting`); the raw pre-screen in `Extrema.lean` changes too. |

## Findings

These came out of the proofs, or out of comparing the proofs with OpenCV's code.

- **OpenCV's default contrast threshold is about 0.0133, not 0.03.** OpenCV divides
  `contrastThreshold = 0.04` by `nOctaveLayers = 3`. Use `contrastThreshold = 0.09` for Lowe's
  final contrast test. (Proved: `default_threshold`, `lowe_setting`.)
- **A bright point is a DoG minimum, not a maximum.** OpenCV computes `L(kσ) − L(σ)`. The DoG
  kernel takes its least value, which is negative, at its centre (proved: `dog_center_min`,
  `dog_center_neg`). Read the same way for blobs, a bright blob on a darker surround is a
  minimum and a dark blob on a lighter surround is a maximum. The blob case is not proven.
- **Clipping at 0.2 does not cap the output at 0.2.** The second normalization scales entries
  back up (proved: `siftNormalize_single`). OpenCV's real cap comes when it stores the result:
  `round(512·u)`, capped at 255, so at most about 0.498 of the unit vector.
- **The extremum test is not "larger than all 26 neighbours".** Ties pass, and the sign of the
  sample decides whether it must be a maximum or a minimum (proved: `Extrema.lean`).
- These two are numeric checks, not proofs:
  - About a quarter of the descriptor's splatted weight lands in the padding ring outside the
    4 × 4 grid, and OpenCV discards it (for a uniform gradient field).
  - OpenCV's bilinear 2× upscale adds blur. With the defaults, and if the input has the assumed
    blur of 0.5, the base layer's blur is about 1.82, not 1.6.

## Build

You need [elan](https://github.com/leanprover/elan). It installs the Lean version that
`lean-toolchain` names.

```bash
cd projects/lean-keypoint-math
lake exe cache get    # download prebuilt Mathlib (several GB)
lake build            # check every proof
```

A clean build of this project takes under a minute once Mathlib is downloaded.

## Check the axioms

```bash
lake env lean scripts/CheckAxioms.lean    # fails on any axiom outside the standard three
lake env lean scripts/PrintAxioms.lean    # lists the axioms of each theorem
```

Every theorem should depend on `[propext, Classical.choice, Quot.sound]` or a subset. A `sorry`
would show up as `sorryAx`.

## Versions

- Lean `v4.35.0-rc3` and Mathlib `v4.35.0-rc3`, pinned in `lean-toolchain` and
  `lake-manifest.json`.
- OpenCV 4.12.0: `modules/features2d/src/sift.dispatch.cpp` and `sift.simd.hpp`.
