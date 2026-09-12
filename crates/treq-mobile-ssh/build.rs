fn main() {
    uniffi::generate_scaffolding("./src/treq_mobile_ssh.udl").unwrap();

    if std::env::var_os("CARGO_FEATURE_NAPI").is_some() {
        napi_build::setup();
    }
}
