// A 75-byte WebAssembly module, encoded by hand so the template needs no assembler. It proves the
// module host end to end: a call that returns, a call that never returns (the watchdog), and a
// declared memory maximum (the limit check).
//
//   (module
//     (memory (export "memory") 1 1)                                      ;; 1 page, max 1
//     (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add)
//     (func (export "spin") (loop br 0)))                                 ;; runs forever
export const TEST_PLUGIN = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, //                     magic, version 1
  0x01, 0x0a, 0x02, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, 0x60, 0x00, 0x00, // types: (i32 i32)→i32, ()→()
  0x03, 0x03, 0x02, 0x00, 0x01, //                                     functions: type 0, type 1
  0x05, 0x04, 0x01, 0x01, 0x01, 0x01, //                               memory: min 1, max 1
  0x07, 0x17, 0x03, //                                                 exports: 3
  0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00, //             "memory" → memory 0
  0x03, 0x61, 0x64, 0x64, 0x00, 0x00, //                               "add" → func 0
  0x04, 0x73, 0x70, 0x69, 0x6e, 0x00, 0x01, //                         "spin" → func 1
  0x0a, 0x11, 0x02, //                                                 code: 2 bodies
  0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b, //                   local.get 0, local.get 1, i32.add
  0x07, 0x00, 0x03, 0x40, 0x0c, 0x00, 0x0b, 0x0b, //                   loop, br 0, end
]);
