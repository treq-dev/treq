Pod::Spec.new do |s|
  s.name             = "TreqMobileSsh"
  s.version          = "0.1.0"
  s.summary          = "UniFFI Swift bindings + native lib for crates/treq-mobile-ssh"
  s.homepage         = "https://github.com/treq-dev/treq"
  s.license          = { :type => "UNLICENSED" }
  s.author           = "treq"
  s.platform         = :ios, "13.0"
  s.source           = { :path => "." }
  s.vendored_frameworks = "TreqMobileSsh.xcframework"

  # TreqMobileSsh.xcframework + TreqMobile/TreqMobileSsh.swift are generated
  # by mobile/scripts/build-ios-xcframework.sh (run before `pod install` in
  # CI, see .github/workflows/mobile-release.yml) rather than committed, so
  # this podspec only declares the shape - it produces nothing on its own.
end
