import Mathlib.Basic.Real.Basic
import Mathlib.Algebra.Order.Field.Basic
import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Positivity

/-!
# OpenCV 4.12's SIFT constants, and the contrast threshold

Claims checked here (Keypoint Detector Math, SIFT):

* the descriptor has `4 × 4 × 8 = 128` entries, the orientation histogram has 36 bins of 10°,
  an extremum is compared with `3³ − 1 = 26` neighbours, and the orientation window's radius is
  `3 × 1.5 = 4.5` scale units;
* OpenCV rejects `|D(x̂)| · nOctaveLayers < contrastThreshold`. That is a threshold of
  `contrastThreshold / nOctaveLayers` on `|D(x̂)|`: `0.04/3 = 1/75 ≈ 0.0133` with the defaults,
  less than half of Lowe's `0.03`. Setting `contrastThreshold = 0.09` makes OpenCV's *final*
  contrast test identical to Lowe's, as OpenCV's documentation says. The raw pre-screen on the
  sample itself also scales with `contrastThreshold`; it is in `Extrema.lean`.

Both thresholds measure `D` with pixel values scaled to `[0, 1]`: OpenCV multiplies by
`img_scale = 1/(255 · SIFT_FIXPT_SCALE)` before the test.

## Sources

`modules/features2d/src/sift.simd.hpp` (the `SIFT_*` constants and `adjustLocalExtrema`) and
`modules/features2d/include/opencv2/features2d.hpp` (the defaults of `SIFT::create`, and the note
"if you want to use the value used in D. Lowe paper, 0.03, set this argument to 0.09").
-/

namespace KeypointMath.SIFT.OpenCV

/-- `SIFT_DESCR_WIDTH`: the descriptor grid is 4 × 4 cells. -/
def SIFT_DESCR_WIDTH : ℕ := 4
/-- `SIFT_DESCR_HIST_BINS`: 8 orientation bins per cell. -/
def SIFT_DESCR_HIST_BINS : ℕ := 8
/-- `SIFT_ORI_HIST_BINS`: 36 bins in the orientation histogram. -/
def SIFT_ORI_HIST_BINS : ℕ := 36
/-- `SIFT_ORI_SIG_FCTR`: the orientation window's Gaussian has σ = 1.5 × scale. -/
def SIFT_ORI_SIG_FCTR : ℝ := 1.5
/-- `SIFT_ORI_RADIUS`, written `3 * SIFT_ORI_SIG_FCTR` in OpenCV's comment. -/
def SIFT_ORI_RADIUS : ℝ := 4.5
/-- `SIFT_ORI_PEAK_RATIO`: every local peak at or above 80% of the highest bin
(`hist[j] >= 0.8·max`) adds a keypoint. -/
def SIFT_ORI_PEAK_RATIO : ℝ := 0.8
/-- `SIFT_DESCR_SCL_FCTR`: each descriptor cell is 3 × scale wide. -/
def SIFT_DESCR_SCL_FCTR : ℝ := 3
/-- `SIFT_DESCR_MAG_THR`: the clip level, 0.2. -/
def SIFT_DESCR_MAG_THR : ℝ := 0.2
/-- `SIFT_INIT_SIGMA`: the input's assumed blur. -/
def SIFT_INIT_SIGMA : ℝ := 0.5
/-- `SIFT_INT_DESCR_FCTR`: the descriptor is stored as `512 ×` the unit vector, rounded and
capped at 255. -/
def SIFT_INT_DESCR_FCTR : ℝ := 512
/-- `SIFT_MAX_INTERP_STEPS`: the sub-pixel fit runs at most 5 times (the first fit and at most 4
retries). -/
def SIFT_MAX_INTERP_STEPS : ℕ := 5
/-- `SIFT_IMG_BORDER`: keypoints stay at least 5 pixels from the image border. -/
def SIFT_IMG_BORDER : ℕ := 5
/-- Default `nOctaveLayers`. -/
def nOctaveLayers : ℕ := 3
/-- Default `contrastThreshold`. -/
def contrastThreshold : ℝ := 0.04
/-- Default `edgeThreshold`. -/
def edgeThreshold : ℝ := 10
/-- Default `sigma`. -/
def sigma : ℝ := 1.6

/-- **The descriptor has 128 entries.** -/
theorem descriptor_length : SIFT_DESCR_WIDTH * SIFT_DESCR_WIDTH * SIFT_DESCR_HIST_BINS = 128 :=
  rfl

/-- **Orientation bins are 10° wide.** -/
theorem ori_bin_width : (360 : ℝ) / SIFT_ORI_HIST_BINS = 10 := by
  norm_num [SIFT_ORI_HIST_BINS]

/-- **An extremum is compared with 26 neighbours:** the 3 × 3 × 3 block minus itself. -/
theorem extremum_neighbours : 3 ^ 3 - 1 = 26 := rfl

/-- The orientation window's radius is 3σ: `SIFT_ORI_RADIUS = 3 · SIFT_ORI_SIG_FCTR`. -/
theorem ori_radius : SIFT_ORI_RADIUS = 3 * SIFT_ORI_SIG_FCTR := by
  norm_num [SIFT_ORI_RADIUS, SIFT_ORI_SIG_FCTR]

/-- Each octave holds `nOctaveLayers + 3 = 6` blurred images and `nOctaveLayers + 2 = 5` DoG
images, so extrema can be searched in the `3` DoG layers that have a layer above and below. -/
theorem layers_per_octave : nOctaveLayers + 3 = 6 ∧ nOctaveLayers + 2 = 5 ∧
    (nOctaveLayers + 2) - 2 = nOctaveLayers := ⟨rfl, rfl, rfl⟩

/-- OpenCV's contrast test, verbatim: reject when `std::abs(contr) * nOctaveLayers <
contrastThreshold`. -/
def contrastReject (contr : ℝ) (layers : ℕ) (threshold : ℝ) : Prop :=
  |contr| * layers < threshold

/-- **OpenCV's test is a threshold of `contrastThreshold / nOctaveLayers` on `|D(x̂)|`.** -/
theorem contrastReject_iff (contr : ℝ) {layers : ℕ} (h : 0 < layers) (threshold : ℝ) :
    contrastReject contr layers threshold ↔ |contr| < threshold / layers := by
  -- `lt_div_iff₀`: `a < b / c ↔ a · c < b` for `c > 0`.
  rw [contrastReject, lt_div_iff₀ (by exact_mod_cast h)]

/-- With the defaults the threshold is `0.04 / 3 = 1/75 ≈ 0.0133`. -/
theorem default_threshold : contrastThreshold / nOctaveLayers = 1 / 75 := by
  norm_num [contrastThreshold, nOctaveLayers]

/-- **OpenCV's default threshold is less than half of Lowe's 0.03.** -/
theorem default_lt_half_lowe : contrastThreshold / nOctaveLayers < 0.03 / 2 := by
  norm_num [contrastThreshold, nOctaveLayers]

/-- **`contrastThreshold = 0.09` with 3 layers is exactly Lowe's test `|D(x̂)| < 0.03`.** -/
theorem lowe_setting (contr : ℝ) : contrastReject contr 3 0.09 ↔ |contr| < 0.03 := by
  rw [contrastReject_iff contr (by norm_num)]
  norm_num

end KeypointMath.SIFT.OpenCV
