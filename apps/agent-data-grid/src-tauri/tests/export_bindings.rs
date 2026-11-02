//! Regenerates `src/bindings.ts` from the specta builder:
//! `cargo test -p agent-data-grid --test export_bindings`.

#[test]
fn export_bindings() {
    agent_data_grid_lib::export_bindings(&agent_data_grid_lib::specta_builder());
}
