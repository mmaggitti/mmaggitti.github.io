# icon-paths.json

Test data for `engine/path`: 623 `d` attribute values, sampled from six open-source icon sets.
They exist to exercise the path parser on real-world writing styles, such as packed arc flags,
glued signs and dots, implicit repeats and relative commands.

- **Sources:** the npm packages below.
- **Sampling:** deterministic, seeded. Up to 8 paths per set for each feature (arcs, packed flags,
  exponents, packed decimals, glued negatives, S/T, Q, implicit arcs and linetos, commas, Z followed
  by a drawing command, leading or trailing whitespace, a relative first moveto). Then up to 40 more
  per set.
- **Exclusions:** paths over 900 characters, paths with newlines, and paths the public-repo guard
  would flag. In packed path data, four dotted numbers in a row can read as a private IP address.

Across all 20,625 files in these packages, 27,963 distinct `d` values parse with no error and
round-trip byte for byte.

| Package | Version | License | Copyright |
| --- | --- | --- | --- |
| `@tabler/icons` | 3.48.0 | MIT | Copyright (c) 2020-2026 Paweł Kuna |
| `bootstrap-icons` | 1.13.1 | MIT | Copyright (c) 2019-2024 The Bootstrap Authors |
| `feather-icons` | 4.29.2 | MIT | Copyright (c) 2013-2023 Cole Bemis |
| `heroicons` | 2.2.0 | MIT | Copyright (c) Tailwind Labs, Inc. |
| `lucide-static` | 1.48.0 | ISC (Feather-derived icons: MIT) | Copyright (c) 2026 Lucide Icons and Contributors; Copyright (c) 2013-present Cole Bemis |
| `simple-icons` | 16.33.0 | CC0-1.0 | none (public domain dedication). The logos are their owners' trademarks. |

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## ISC License

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee
is hereby granted, provided that the above copyright notice and this permission notice appear in all
copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE
INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE
LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER
RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
