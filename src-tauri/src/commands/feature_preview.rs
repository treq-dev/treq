use crate::core::feature_preview::{self, PreviewFeature};
use crate::AppState;
use tauri::State;

pub fn require(state: &State<AppState>, feature: PreviewFeature) -> Result<(), String> {
  let db = state.db.lock().unwrap();
  feature_preview::require(&db, feature)
}
