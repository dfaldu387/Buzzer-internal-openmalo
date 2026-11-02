#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(BuzzerAlarmModule, NSObject)

RCT_EXTERN_METHOD(activateAlarmSession:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(deactivateAlarmSession:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopAlarm)

@end
