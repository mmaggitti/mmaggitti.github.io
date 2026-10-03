/* @ts-self-types="./cadk_wasm.d.ts" */

/**
 * An assembly of a package, its parts rebuilt in one configuration, for solving its joints as
 * a parameter changes (K4.2) and for motion studies with clash checks (Q2.1, Q2.2).
 */
export class AssemblyModel {
    static __wrap(ptr) {
        const obj = Object.create(AssemblyModel.prototype);
        obj.__wbg_ptr = ptr;
        AssemblyModelFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AssemblyModelFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_assemblymodel_free(ptr, 0);
    }
    /**
     * Solve the joints with parameter `param` at `value` (base units: the package's length
     * unit, radians), starting from the last solve. Returns JSON: the largest residual, the
     * freedom left, the joints that can't hold, and each instance's placement.
     * @param {string} param
     * @param {number} value
     * @returns {string}
     */
    solve(param, value) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(param, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.assemblymodel_solve(this.__wbg_ptr, ptr0, len0, value);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * A motion study: sweep `param` through `values` (a JSON array, base units), solving at
     * each from the last, and clash-check at the step indices `checks` (a JSON array) every
     * pair of bodies whose boxes come within `near`, in the package's length unit; a `near` of 0
     * picks the default, 5 mm in that unit. Returns `cadk.motion` JSON.
     * @param {string} param
     * @param {string} values
     * @param {string} checks
     * @param {number} near
     * @returns {string}
     */
    sweep(param, values, checks, near) {
        let deferred5_0;
        let deferred5_1;
        try {
            const ptr0 = passStringToWasm0(param, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(values, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(checks, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len2 = WASM_VECTOR_LEN;
            const ret = wasm.assemblymodel_sweep(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, near);
            var ptr4 = ret[0];
            var len4 = ret[1];
            if (ret[3]) {
                ptr4 = 0; len4 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
        }
    }
}
if (Symbol.dispose) AssemblyModel.prototype[Symbol.dispose] = AssemblyModel.prototype.free;

/**
 * A tessellation as typed arrays: float32 positions and normals (xyz per vertex), uint32
 * triangle indices, the body face of each triangle, and edge polylines (edge index, then
 * vertex indices, flattened with counts).
 */
export class MeshOut {
    static __wrap(ptr) {
        const obj = Object.create(MeshOut.prototype);
        obj.__wbg_ptr = ptr;
        MeshOutFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MeshOutFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_meshout_free(ptr, 0);
    }
    /**
     * Edge polylines: for each, the edge index, the point count n, then n vertex indices.
     * @returns {Uint32Array}
     */
    get edges() {
        const ret = wasm.meshout_edges(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    get faceOf() {
        const ret = wasm.meshout_faceOf(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    get indices() {
        const ret = wasm.meshout_indices(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    get normals() {
        const ret = wasm.meshout_normals(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    get positions() {
        const ret = wasm.meshout_positions(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}
if (Symbol.dispose) MeshOut.prototype[Symbol.dispose] = MeshOut.prototype.free;

/**
 * A rebuilt result layer: file paths inside the package and their bytes.
 */
export class Rebuilt {
    static __wrap(ptr) {
        const obj = Object.create(Rebuilt.prototype);
        obj.__wbg_ptr = ptr;
        RebuiltFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RebuiltFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_rebuilt_free(ptr, 0);
    }
    /**
     * Assembly `aid` of the first configuration rebuilt, held for solving as `loadAssembly`
     * holds it, from the parts this rebuild already made. Consumes the result: read its files
     * first.
     * @param {string} aid
     * @returns {AssemblyModel}
     */
    assembly(aid) {
        const ptr = this.__destroy_into_raw();
        const ptr0 = passStringToWasm0(aid, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rebuilt_assembly(ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return AssemblyModel.__wrap(ret[0]);
    }
    /**
     * A result file's bytes.
     * @param {string} path
     * @returns {Uint8Array | undefined}
     */
    bytes(path) {
        const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rebuilt_bytes(this.__wbg_ptr, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
    /**
     * Every input value of the package that can't be used, each as a message saying where it is,
     * what's wrong and what it fails, as the command line prints them: an expression that doesn't
     * parse, names a parameter that isn't there, or whose value can't be had (the wrong quantity
     * for its field), and a value of the wrong kind for its field (text where a length goes, a
     * number where a boolean goes, a vector of the wrong length); one that nothing reads included,
     * which no result file has room for; and, as unsupported, a form this Rebuilder doesn't
     * implement (Mark's ruling, 2026-10-03, round X6). Each fails only what reads it, and the
     * parts' and assemblies' own messages in `summary` name those that fail theirs (Mark's
     * rulings, 2026-10-01 and 2026-10-02). JSON: an array for the configuration rebuilt, or
     * `{configuration: [...]}` for every one (`rebuildPackage(…, 'all')`); empty when every
     * value can be used. The name is the binding's since round X, when only expressions were
     * listed; it is to be renamed at the next breaking change (Mark, 2026-10-02).
     * @returns {string}
     */
    get expressions() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.rebuilt_expressions(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Paths of the result files, sorted.
     * @returns {string[]}
     */
    paths() {
        const ret = wasm.rebuilt_paths(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Each part's and assembly's state, the items that failed and the errors of it as a whole,
     * as JSON: `{id: {state, bodies | instances, errors, messages?}}` for the configuration
     * rebuilt, or `{configuration: {id: …}}` for every one (`rebuildPackage(…, 'all')`).
     * @returns {string}
     */
    get summary() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.rebuilt_summary(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * A result file as text (JSON files).
     * @param {string} path
     * @returns {string | undefined}
     */
    text(path) {
        const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rebuilt_text(this.__wbg_ptr, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
}
if (Symbol.dispose) Rebuilt.prototype[Symbol.dispose] = Rebuilt.prototype.free;

/**
 * Bodies held in kernel memory. Handles are never reused; a freed or unknown handle fails with
 * `input.invalid_handle`.
 */
export class Session {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SessionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_session_free(ptr, 0);
    }
    /**
     * Tight bounding box (Q4.2): [min x, y, z, max x, y, z].
     * @param {number} h
     * @returns {Float64Array}
     */
    bbox(h) {
        const ret = wasm.session_bbox(this.__wbg_ptr, h);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} frame_
     * @param {number} dx
     * @param {number} dy
     * @param {number} dz
     * @returns {string}
     */
    block(frame_, dx, dy, dz) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArrayF64ToWasm0(frame_, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_block(this.__wbg_ptr, ptr0, len0, dx, dy, dz);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Validity check (R1.1, R1.2): a JSON list of faults, empty when valid.
     * @param {number} h
     * @param {boolean} deep
     * @returns {string}
     */
    check(h, deep) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.session_check(this.__wbg_ptr, h, deep);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @param {Float64Array} frame_
     * @param {number} r1
     * @param {number} r2
     * @param {number} h
     * @returns {string}
     */
    cone(frame_, r1, r2, h) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArrayF64ToWasm0(frame_, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_cone(this.__wbg_ptr, ptr0, len0, r1, r2, h);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Entity counts as JSON.
     * @param {number} h
     * @returns {string}
     */
    counts(h) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.session_counts(this.__wbg_ptr, h);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @param {Float64Array} frame_
     * @param {number} r
     * @param {number} h
     * @returns {string}
     */
    cylinder(frame_, r, h) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArrayF64ToWasm0(frame_, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_cylinder(this.__wbg_ptr, ptr0, len0, r, h);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Extrude a profile (C2.1) along `dir` from `start` to `end`.
     * @param {string} profile_json
     * @param {Float64Array} dir
     * @param {number} start
     * @param {number} end
     * @returns {string}
     */
    extrude(profile_json, dir, start, end) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(profile_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArrayF64ToWasm0(dir, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.session_extrude(this.__wbg_ptr, ptr0, len0, ptr1, len1, start, end);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Number of live bodies.
     * @returns {number}
     */
    get live() {
        const ret = wasm.session_live(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Mass properties (Q4.1): [volume, area, mass, centroid x, y, z, inertia (9, row-major,
     * about the centroid)]. A density that isn't finite fails as `input.not_finite`, a negative
     * one as `mass_properties.negative_density` (standard 5.1).
     * @param {number} h
     * @param {number} density
     * @returns {Float64Array}
     */
    massProperties(h, density) {
        const ret = wasm.session_massProperties(this.__wbg_ptr, h, density);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    constructor() {
        const ret = wasm.session_new();
        this.__wbg_ptr = ret;
        SessionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Read brep.json (T3.1): `{"bodies": [handles], "names": {...}, "header": {...}}`. The
     * bodies are built at the file's tolerance, or without one at 1e-7 mm in its length unit
     * (standard 5.2).
     * @param {string} text
     * @param {string} version
     * @returns {string}
     */
    readBrepJson(text, version) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(version, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.session_readBrepJson(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Release a body. Its handle is not reused. (`free()` releases the whole session.)
     * @param {number} h
     */
    release(h) {
        const ret = wasm.session_release(this.__wbg_ptr, h);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Revolve a profile (C2.2) about an axis in its plane by `angle` radians.
     * @param {string} profile_json
     * @param {Float64Array} axis_origin
     * @param {Float64Array} axis_dir
     * @param {number} angle
     * @returns {string}
     */
    revolve(profile_json, axis_origin, axis_dir, angle) {
        let deferred5_0;
        let deferred5_1;
        try {
            const ptr0 = passStringToWasm0(profile_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArrayF64ToWasm0(axis_origin, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passArrayF64ToWasm0(axis_dir, wasm.__wbindgen_malloc);
            const len2 = WASM_VECTOR_LEN;
            const ret = wasm.session_revolve(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, angle);
            var ptr4 = ret[0];
            var len4 = ret[1];
            if (ret[3]) {
                ptr4 = 0; len4 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * @param {Float64Array} frame_
     * @param {number} r
     * @returns {string}
     */
    sphere(frame_, r) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArrayF64ToWasm0(frame_, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_sphere(this.__wbg_ptr, ptr0, len0, r);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Tessellate (H1.1, H1.2). A chord of 0 picks the default for the body's size (standard
     * 15.1); an angle of 0 picks the default, 0.2 rad. Any other value goes to the kernel as
     * given, which refuses NaN and infinity as `input.not_finite` (standard 5.1) and a
     * negative tolerance as `mesh.invalid_tolerance`.
     * @param {number} h
     * @param {number} chord
     * @param {number} angle
     * @returns {MeshOut}
     */
    tessellate(h, chord, angle) {
        const ret = wasm.session_tessellate(this.__wbg_ptr, h, chord, angle);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return MeshOut.__wrap(ret[0]);
    }
    /**
     * @param {Float64Array} frame_
     * @param {number} major
     * @param {number} minor
     * @returns {string}
     */
    torus(frame_, major, minor) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArrayF64ToWasm0(frame_, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_torus(this.__wbg_ptr, ptr0, len0, major, minor);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Move, rotate, mirror or uniformly scale a body (C4.1) by a row-major 3×4 matrix.
     * @param {number} h
     * @param {Float64Array} m
     * @returns {string}
     */
    transform(h, m) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArrayF64ToWasm0(m, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_transform(this.__wbg_ptr, h, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Write brep.json (T3.1) for bodies, with the Rebuilder's names and header (the same shapes
     * `readBrepJson` returns). A header without a tolerance is written at 1e-7 mm in its length
     * unit.
     * @param {Uint32Array} handles
     * @param {string} names_json
     * @param {string} header_json
     * @param {string} version
     * @returns {string}
     */
    writeBrepJson(handles, names_json, header_json, version) {
        let deferred6_0;
        let deferred6_1;
        try {
            const ptr0 = passArray32ToWasm0(handles, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(names_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(header_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passStringToWasm0(version, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len3 = WASM_VECTOR_LEN;
            const ret = wasm.session_writeBrepJson(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
            var ptr5 = ret[0];
            var len5 = ret[1];
            if (ret[3]) {
                ptr5 = 0; len5 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred6_0 = ptr5;
            deferred6_1 = len5;
            return getStringFromWasm0(ptr5, len5);
        } finally {
            wasm.__wbindgen_free(deferred6_0, deferred6_1, 1);
        }
    }
}
if (Symbol.dispose) Session.prototype[Symbol.dispose] = Session.prototype.free;

/**
 * Deliberately trap the instance, so the binding's `kernel.trapped` path can be tested.
 */
export function debugTrap() {
    wasm.debugTrap();
}

/**
 * Kernel name, version, the standard it targets and its tier, as JSON.
 * @returns {string}
 */
export function kernelInfo() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.kernelInfo();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Rebuild configuration `cfg` of a package (files as for `rebuildPackage`) and hold assembly
 * `aid` for solving.
 * @param {string} files_json
 * @param {string} cfg
 * @param {string} aid
 * @returns {AssemblyModel}
 */
export function loadAssembly(files_json, cfg, aid) {
    const ptr0 = passStringToWasm0(files_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(cfg, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(aid, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.loadAssembly(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return AssemblyModel.__wrap(ret[0]);
}

/**
 * Robust orientation of three 2D points (N1.1): positive counterclockwise, exact sign.
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {number} cx
 * @param {number} cy
 * @returns {number}
 */
export function orient2d(ax, ay, bx, by, cx, cy) {
    const ret = wasm.orient2d(ax, ay, bx, by, cx, cy);
    return ret;
}

/**
 * The determinism probe's digest (K2.3); must equal the native build's.
 * @returns {string}
 */
export function probeDigest() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.probeDigest();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Rebuild a package's results (K4.6) from its files: a JSON object of path → text holding
 * `manifest.json` and the files it lists. `configurations` is a configuration's ID, or `all`
 * for every configuration the package declares; without it, the default configuration. The
 * files hold, too, the results of each part an instance counts in another configuration, in
 * that one, as rebuilding it writes them; `summary` keeps to the configurations asked for.
 * @param {string} files_json
 * @param {string | null} [configurations]
 * @returns {Rebuilt}
 */
export function rebuildPackage(files_json, configurations) {
    const ptr0 = passStringToWasm0(files_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(configurations) ? 0 : passStringToWasm0(configurations, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.rebuildPackage(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Rebuilt.__wrap(ret[0]);
}

/**
 * The declared tolerances (N1.2): [linear resolution, angular resolution, size box].
 * @returns {Float64Array}
 */
export function tolerances() {
    const ret = wasm.tolerances();
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_30c8987f7c2ed4e2: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./cadk_wasm_bg.js": import0,
    };
}

const AssemblyModelFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_assemblymodel_free(ptr, 1));
const MeshOutFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_meshout_free(ptr, 1));
const RebuiltFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_rebuilt_free(ptr, 1));
const SessionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_session_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('cadk_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
