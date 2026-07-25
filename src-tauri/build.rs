use std::path::PathBuf;

const EMBEDDED_LICENSES_CFG: &str = "embedded_licenses";
const LICENSE_FILES: [&str; 3] = [
    "licenses/js-licenses.json",
    "licenses/cargo-licenses.json",
    "licenses/manual-licenses.json",
];

fn main() {
    println!("cargo:rustc-check-cfg=cfg({EMBEDDED_LICENSES_CFG})");

    let workspace_dir = PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR must be available"),
    )
    .parent()
    .expect("src-tauri must have a workspace parent")
    .to_path_buf();

    let mut all_license_files_exist = true;
    for relative_path in LICENSE_FILES {
        let path = workspace_dir.join(relative_path);
        println!("cargo:rerun-if-changed={}", path.display());
        all_license_files_exist &= path.is_file();
    }

    if all_license_files_exist {
        println!("cargo:rustc-cfg={EMBEDDED_LICENSES_CFG}");
    }

    tauri_build::build()
}
