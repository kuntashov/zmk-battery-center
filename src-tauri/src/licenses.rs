use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JsLicense {
    pub name: String,
    pub version: String,
    pub license: Option<String>,
    pub repository: Option<String>,
    pub publisher: Option<String>,
    pub path: Option<String>,
    #[serde(rename = "licenseText")]
    pub license_text: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CargoLicense {
    pub name: String,
    pub version: String,
    pub license: Option<String>,
    pub authors: Option<Vec<String>>,
    pub repository: Option<String>,
    #[serde(rename = "licenseText")]
    pub license_text: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LicensesData {
    pub js_licenses: Vec<JsLicense>,
    pub cargo_licenses: Vec<CargoLicense>,
}

#[cfg(embedded_licenses)]
const EMBEDDED_JS_LICENSES: &str = include_str!("../../licenses/js-licenses.json");
#[cfg(embedded_licenses)]
const EMBEDDED_CARGO_LICENSES: &str = include_str!("../../licenses/cargo-licenses.json");
#[cfg(embedded_licenses)]
const EMBEDDED_MANUAL_LICENSES: &str = include_str!("../../licenses/manual-licenses.json");

fn find_licenses_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    // Try resource dir first (for bundled app)
    if let Ok(resource_path) = app.path().resource_dir() {
        // Check direct path (bundled resources are flattened)
        let direct_js = resource_path.join("js-licenses.json");
        if direct_js.exists() {
            return Ok(resource_path);
        }

        // Check licenses subdirectory
        let licenses_dir = resource_path.join("licenses");
        if licenses_dir.join("js-licenses.json").exists() {
            return Ok(licenses_dir);
        }

        // Check _up_/licenses subdirectory
        // When tauri.conf.json specifies "../licenses/*.json" as resources,
        // Tauri replaces ".." with "_up_" in the bundled path.
        let up_licenses_dir = resource_path.join("_up_").join("licenses");
        if up_licenses_dir.join("js-licenses.json").exists() {
            return Ok(up_licenses_dir);
        }
    }

    // For development: try relative path from src-tauri
    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("licenses"))
        .ok_or_else(|| "Failed to get parent directory".to_string())?;

    if dev_path.join("js-licenses.json").exists() {
        return Ok(dev_path);
    }

    Err(format!(
        "Could not find licenses directory. Tried resource_dir and dev path: {:?}",
        dev_path
    ))
}

fn parse_licenses(
    js_content: &str,
    cargo_content: &str,
    manual_content: Option<&str>,
) -> Result<LicensesData, String> {
    let mut js_licenses: Vec<JsLicense> = serde_json::from_str(js_content)
        .map_err(|error| format!("Failed to parse js-licenses.json: {error}"))?;
    let cargo_licenses: Vec<CargoLicense> = serde_json::from_str(cargo_content)
        .map_err(|error| format!("Failed to parse cargo-licenses.json: {error}"))?;

    if let Some(manual_content) = manual_content {
        if let Ok(manual_licenses) = serde_json::from_str::<Vec<JsLicense>>(manual_content) {
            js_licenses.extend(manual_licenses);
        }
    }

    Ok(LicensesData {
        js_licenses,
        cargo_licenses,
    })
}

fn read_licenses_dir(licenses_dir: &std::path::Path) -> Result<LicensesData, String> {
    let js_licenses_path = licenses_dir.join("js-licenses.json");
    let js_licenses_content = std::fs::read_to_string(&js_licenses_path).map_err(|e| {
        format!(
            "Failed to read js-licenses.json from {:?}: {}",
            js_licenses_path, e
        )
    })?;

    let cargo_licenses_path = licenses_dir.join("cargo-licenses.json");
    let cargo_licenses_content = std::fs::read_to_string(&cargo_licenses_path).map_err(|e| {
        format!(
            "Failed to read cargo-licenses.json from {:?}: {}",
            cargo_licenses_path, e
        )
    })?;

    let manual_licenses_path = licenses_dir.join("manual-licenses.json");
    let manual_content = std::fs::read_to_string(manual_licenses_path).ok();

    parse_licenses(
        &js_licenses_content,
        &cargo_licenses_content,
        manual_content.as_deref(),
    )
}

#[cfg(embedded_licenses)]
fn read_embedded_licenses() -> Result<LicensesData, String> {
    parse_licenses(
        EMBEDDED_JS_LICENSES,
        EMBEDDED_CARGO_LICENSES,
        Some(EMBEDDED_MANUAL_LICENSES),
    )
}

#[cfg(not(embedded_licenses))]
fn read_embedded_licenses() -> Result<LicensesData, String> {
    Err("No license data was embedded at build time".to_string())
}

#[tauri::command]
pub fn get_licenses(app: tauri::AppHandle) -> Result<LicensesData, String> {
    match find_licenses_dir(&app) {
        Ok(licenses_dir) => read_licenses_dir(&licenses_dir),
        Err(external_error) => read_embedded_licenses()
            .map_err(|embedded_error| format!("{external_error}. {embedded_error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const JS_LICENSES: &str = r#"[
        {
            "name": "js-package",
            "version": "1.0.0",
            "license": "MIT",
            "repository": null,
            "publisher": null,
            "path": null,
            "licenseText": "JS license"
        }
    ]"#;
    const CARGO_LICENSES: &str = r#"[
        {
            "name": "cargo-package",
            "version": "2.0.0",
            "license": "Apache-2.0",
            "authors": ["Author"],
            "repository": null,
            "licenseText": "Cargo license"
        }
    ]"#;
    const MANUAL_LICENSES: &str = r#"[
        {
            "name": "manual-package",
            "version": "",
            "license": "MIT",
            "repository": null,
            "publisher": "Publisher",
            "path": "",
            "licenseText": "Manual license"
        }
    ]"#;

    #[test]
    fn parses_generated_licenses_and_appends_manual_entries() {
        let licenses = parse_licenses(JS_LICENSES, CARGO_LICENSES, Some(MANUAL_LICENSES)).unwrap();

        assert_eq!(licenses.js_licenses.len(), 2);
        assert_eq!(licenses.js_licenses[0].name, "js-package");
        assert_eq!(licenses.js_licenses[1].name, "manual-package");
        assert_eq!(licenses.cargo_licenses.len(), 1);
        assert_eq!(licenses.cargo_licenses[0].name, "cargo-package");
    }

    #[test]
    fn reports_generated_license_parse_errors_with_the_source_name() {
        let js_error = parse_licenses("{", CARGO_LICENSES, None).unwrap_err();
        assert!(js_error.starts_with("Failed to parse js-licenses.json:"));

        let cargo_error = parse_licenses(JS_LICENSES, "{", None).unwrap_err();
        assert!(cargo_error.starts_with("Failed to parse cargo-licenses.json:"));
    }

    #[test]
    fn ignores_invalid_optional_manual_licenses() {
        let licenses = parse_licenses(JS_LICENSES, CARGO_LICENSES, Some("{")).unwrap();

        assert_eq!(licenses.js_licenses.len(), 1);
        assert_eq!(licenses.cargo_licenses.len(), 1);
    }

    #[cfg(embedded_licenses)]
    #[test]
    fn parses_build_time_embedded_licenses() {
        let licenses = read_embedded_licenses().unwrap();

        assert!(!licenses.js_licenses.is_empty());
        assert!(!licenses.cargo_licenses.is_empty());
        assert!(licenses
            .js_licenses
            .iter()
            .any(|license| license.name == "zmk-studio-old (for the app icon)"));
    }

    #[cfg(not(embedded_licenses))]
    #[test]
    fn reports_when_build_time_licenses_are_unavailable() {
        assert_eq!(
            read_embedded_licenses().unwrap_err(),
            "No license data was embedded at build time"
        );
    }
}
