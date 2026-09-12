#import <React/RCTBridgeModule.h>

// Exposes TreqSshBridge.swift's @objc methods to the React Native JS
// bridge under the module name "TreqSsh" (see src/native/TreqSsh.ts).
@interface RCT_EXTERN_MODULE(TreqSsh, NSObject)

RCT_EXTERN_METHOD(generateDeviceKey:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(connect:(NSString *)host
                  port:(nonnull NSNumber *)port
                  username:(NSString *)username
                  keyHandle:(NSString *)keyHandle
                  expectedFingerprintSha256:(NSString *)expectedFingerprintSha256
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(execCommand:(NSString *)sessionId
                  argv:(NSArray<NSString *> *)argv
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(disconnect:(NSString *)sessionId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
