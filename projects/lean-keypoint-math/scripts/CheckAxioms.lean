import KeypointMath

/-!
Fails if any declaration in `KeypointMath` depends on an axiom other than Lean's three standard
ones: `propext`, `Classical.choice` and `Quot.sound`. A `sorry` would show up as `sorryAx`, and
`native_decide` as `Lean.ofReduceBool`. Run it after `lake build`:

    lake env lean scripts/CheckAxioms.lean

`PrintAxioms.lean` prints the same information theorem by theorem.
-/

open Lean in
#eval show CoreM Unit from do
  let allowed := [``propext, ``Classical.choice, ``Quot.sound]
  let mut checked := 0
  for (name, _) in (← getEnv).constants.toList do
    if (`KeypointMath).isPrefixOf name then
      checked := checked + 1
      for ax in ← collectAxioms name do
        unless allowed.contains ax do
          throwError "{name} depends on {ax}"
  IO.println s!"{checked} declarations in KeypointMath use only the standard axioms."
