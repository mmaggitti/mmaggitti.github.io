/-
Keypoint detector math, verified in Lean 4 + Mathlib.

SIFT, step by step, following the "Keypoint Detector Math" doc and OpenCV 4.12's code.
-/
import KeypointMath.SIFT.ScaleSpace
import KeypointMath.SIFT.DoG
import KeypointMath.SIFT.Extrema
import KeypointMath.SIFT.SubpixelFit
import KeypointMath.SIFT.EdgeTest
import KeypointMath.SIFT.OrientationPeak
import KeypointMath.SIFT.Descriptor
import KeypointMath.SIFT.Normalization
import KeypointMath.SIFT.Constants
