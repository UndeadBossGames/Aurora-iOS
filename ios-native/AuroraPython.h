// Aurora for iPhone: a tiny bridge to the embedded Python interpreter.
// Swift can't call CPython's variadic C API directly, so this Objective-C class does it.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface AuroraPython : NSObject
/// Starts Python (once) and imports the `aurora_dl` module. Returns nil on success, or an error message.
+ (nullable NSString *)start;
/// Calls `aurora_dl.<function>(arg)` and returns its string result (always JSON).
+ (NSString *)call:(NSString *)function arg:(NSString *)arg;
@end

NS_ASSUME_NONNULL_END
