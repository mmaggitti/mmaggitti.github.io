import KeypointMath

/-! Prints the axioms every theorem depends on.
Expected for each: `[propext, Classical.choice, Quot.sound]` (or a subset).
Any other axiom, or `sorryAx`, would mean a gap. `CheckAxioms.lean` fails on one. -/

-- ScaleSpace.lean
#print axioms KeypointMath.SIFT.blurKernel_conv
#print axioms KeypointMath.SIFT.map_mul_blurKernel
#print axioms KeypointMath.SIFT.scaleStep_pow
#print axioms KeypointMath.SIFT.one_le_scaleStep
#print axioms KeypointMath.SIFT.layerSigma_succ
#print axioms KeypointMath.SIFT.layerSigma_add
#print axioms KeypointMath.SIFT.incSigma_eq_opencv
#print axioms KeypointMath.SIFT.layerSigma_sq_add_incSigma_sq
#print axioms KeypointMath.SIFT.pyramidKernel_eq
#print axioms KeypointMath.SIFT.octave_handoff
#print axioms KeypointMath.SIFT.base_blur
#print axioms KeypointMath.SIFT.base_blur_no_upscale

-- DoG.lean
#print axioms KeypointMath.SIFT.hasDerivAt_gauss2_x
#print axioms KeypointMath.SIFT.hasDerivAt_gauss2_y
#print axioms KeypointMath.SIFT.deriv_gauss2_x
#print axioms KeypointMath.SIFT.deriv_gauss2_y
#print axioms KeypointMath.SIFT.deriv2_gauss2_x
#print axioms KeypointMath.SIFT.deriv2_gauss2_y
#print axioms KeypointMath.SIFT.laplacian2_gauss2
#print axioms KeypointMath.SIFT.hasDerivAt_gauss2_σ
#print axioms KeypointMath.SIFT.gauss2_heat
#print axioms KeypointMath.SIFT.dog_div_tendsto
#print axioms KeypointMath.SIFT.dog_center_neg
#print axioms KeypointMath.SIFT.dog_center_min
#print axioms KeypointMath.SIFT.tendsto_scaleStep
#print axioms KeypointMath.SIFT.dog_div_tendsto_layers
#print axioms KeypointMath.SIFT.gauss2_eq_mul

-- Extrema.lean
#print axioms KeypointMath.SIFT.opencvCandidate_iff
#print axioms KeypointMath.SIFT.opencvCandidate_pos
#print axioms KeypointMath.SIFT.opencvCandidate_neg
#print axioms KeypointMath.SIFT.opencvCandidate_plateau
#print axioms KeypointMath.SIFT.candidateThreshold_default
#print axioms KeypointMath.SIFT.candidateThreshold_lowe
#print axioms KeypointMath.SIFT.candidateThreshold_le

-- SubpixelFit.lean
#print axioms KeypointMath.SIFT.mulVec_newtonStep
#print axioms KeypointMath.SIFT.dotProduct_mulVec_comm
#print axioms KeypointMath.SIFT.quadModel_add
#print axioms KeypointMath.SIFT.quadModel_newtonStep_add
#print axioms KeypointMath.SIFT.quadModel_newtonStep
#print axioms KeypointMath.SIFT.opencvContr_eq
#print axioms KeypointMath.SIFT.opencv_contrast_reject_iff
#print axioms KeypointMath.SIFT.hasDerivAt_quadModel_line
#print axioms KeypointMath.SIFT.isStationary_iff
#print axioms KeypointMath.SIFT.star_vec
#print axioms KeypointMath.SIFT.quadModel_newtonStep_lt_of_posDef
#print axioms KeypointMath.SIFT.quadModel_newtonStep_le_of_posDef
#print axioms KeypointMath.SIFT.quadModel_lt_newtonStep_of_negDef

-- EdgeTest.lean
#print axioms KeypointMath.SIFT.trace_hess2
#print axioms KeypointMath.SIFT.det_hess2
#print axioms KeypointMath.SIFT.disc_hess2
#print axioms KeypointMath.SIFT.eig_sum
#print axioms KeypointMath.SIFT.eig_prod
#print axioms KeypointMath.SIFT.charpoly_hess2
#print axioms KeypointMath.SIFT.isEigenvalue_of_charpoly
#print axioms KeypointMath.SIFT.isEigenvalue_iff
#print axioms KeypointMath.SIFT.trace_sq_div_det_eq
#print axioms KeypointMath.SIFT.trace_sq_div_det_hess2
#print axioms KeypointMath.SIFT.edge_fn_lt_iff
#print axioms KeypointMath.SIFT.ratio_test_iff
#print axioms KeypointMath.SIFT.lowe_iff_opencv
#print axioms KeypointMath.SIFT.opencv_edge_keep_iff

-- OrientationPeak.lean
#print axioms KeypointMath.SIFT.parabola_interpolates
#print axioms KeypointMath.SIFT.curvature_neg
#print axioms KeypointMath.SIFT.curvature_mul_peakOffset
#print axioms KeypointMath.SIFT.parabola_vertex_form
#print axioms KeypointMath.SIFT.parabola_le_peak
#print axioms KeypointMath.SIFT.hasDerivAt_parabola_peak
#print axioms KeypointMath.SIFT.abs_peakOffset_lt
#print axioms KeypointMath.SIFT.peakOffset_mul

-- Descriptor.lean
#print axioms KeypointMath.SIFT.triWeight_sum
#print axioms KeypointMath.SIFT.triWeight_nonneg
#print axioms KeypointMath.SIFT.triWeight_mean_row
#print axioms KeypointMath.SIFT.triWeight_mean_col
#print axioms KeypointMath.SIFT.triWeight_mean_ori
#print axioms KeypointMath.SIFT.opencvSplat_eq
#print axioms KeypointMath.SIFT.opencvSplat_sum

-- Normalization.lean
#print axioms KeypointMath.SIFT.l2norm_nonneg
#print axioms KeypointMath.SIFT.l2norm_eq_zero
#print axioms KeypointMath.SIFT.l2norm_pos
#print axioms KeypointMath.SIFT.l2norm_smul
#print axioms KeypointMath.SIFT.l2norm_normalize
#print axioms KeypointMath.SIFT.normalize_ne_zero
#print axioms KeypointMath.SIFT.normalize_smul
#print axioms KeypointMath.SIFT.smul_normalize
#print axioms KeypointMath.SIFT.clip_smul
#print axioms KeypointMath.SIFT.clip_eq_zero_iff
#print axioms KeypointMath.SIFT.opencvNormalize_eq_siftNormalize
#print axioms KeypointMath.SIFT.l2norm_siftNormalize
#print axioms KeypointMath.SIFT.siftNormalize_smul
#print axioms KeypointMath.SIFT.siftNormalize_order_ratio
#print axioms KeypointMath.SIFT.l2norm_single
#print axioms KeypointMath.SIFT.siftNormalize_single
#print axioms KeypointMath.SIFT.gradAt_affine
#print axioms KeypointMath.SIFT.rawHist_affine
#print axioms KeypointMath.SIFT.descriptor_affine_invariant

-- Constants.lean
#print axioms KeypointMath.SIFT.OpenCV.descriptor_length
#print axioms KeypointMath.SIFT.OpenCV.ori_bin_width
#print axioms KeypointMath.SIFT.OpenCV.extremum_neighbours
#print axioms KeypointMath.SIFT.OpenCV.ori_radius
#print axioms KeypointMath.SIFT.OpenCV.layers_per_octave
#print axioms KeypointMath.SIFT.OpenCV.contrastReject_iff
#print axioms KeypointMath.SIFT.OpenCV.default_threshold
#print axioms KeypointMath.SIFT.OpenCV.default_lt_half_lowe
#print axioms KeypointMath.SIFT.OpenCV.lowe_setting
