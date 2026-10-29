#import "AuroraPython.h"
#include <Python/Python.h>

static BOOL gStarted = NO;
static NSString *gError = nil;
static PyObject *gModule = NULL;

// The current Python exception as text (with traceback when possible). Caller holds the GIL.
static NSString *AuroraPyError(void) {
    PyObject *type = NULL, *value = NULL, *tb = NULL;
    PyErr_Fetch(&type, &value, &tb);
    if (!type) return @"Unknown Python error";
    PyErr_NormalizeException(&type, &value, &tb);
    NSString *out = nil;
    PyObject *tbmod = PyImport_ImportModule("traceback");
    if (tbmod) {
        PyObject *lines = PyObject_CallMethod(tbmod, "format_exception", "OOO", type, value ? value : Py_None, tb ? tb : Py_None);
        if (lines) {
            PyObject *sep = PyUnicode_FromString("");
            PyObject *joined = sep ? PyUnicode_Join(sep, lines) : NULL;
            if (joined) { const char *s = PyUnicode_AsUTF8(joined); if (s) out = [NSString stringWithUTF8String:s]; Py_DECREF(joined); }
            Py_XDECREF(sep);
            Py_DECREF(lines);
        }
        Py_DECREF(tbmod);
    }
    if (!out && value) {
        PyObject *str = PyObject_Str(value);
        if (str) { const char *s = PyUnicode_AsUTF8(str); if (s) out = [NSString stringWithUTF8String:s]; Py_DECREF(str); }
    }
    PyErr_Clear();
    Py_XDECREF(type); Py_XDECREF(value); Py_XDECREF(tb);
    return out ?: @"Unknown Python error";
}

static NSString *AuroraJSONError(NSString *msg) {
    NSData *d = [NSJSONSerialization dataWithJSONObject:@{ @"ok": @NO, @"error": msg ?: @"error" } options:0 error:nil];
    return d ? [[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding] : @"{\"ok\":false}";
}

static void AppendPath(PyConfig *config, NSString *path) {
    wchar_t *w = Py_DecodeLocale(path.UTF8String, NULL);
    if (w) { PyWideStringList_Append(&config->module_search_paths, w); PyMem_RawFree(w); }
}

@implementation AuroraPython

+ (nullable NSString *)start {
    @synchronized (self) {
        if (gStarted) return gError;
        gStarted = YES;

        NSString *res = [[NSBundle mainBundle] resourcePath];
        NSString *home = [res stringByAppendingPathComponent:@"python"];
        NSString *lib = [home stringByAppendingPathComponent:@"lib"];
        NSString *pyver = nil;
        for (NSString *name in [[NSFileManager defaultManager] contentsOfDirectoryAtPath:lib error:nil]) {
            if ([name hasPrefix:@"python3."]) { pyver = name; break; }
        }
        if (!pyver) { gError = @"Python's standard library is missing from the app."; return gError; }
        NSString *stdlib = [lib stringByAppendingPathComponent:pyver];

        PyStatus status;
        PyPreConfig preconfig;
        PyPreConfig_InitIsolatedConfig(&preconfig);
        preconfig.utf8_mode = 1;
        preconfig.configure_locale = 1;
        status = Py_PreInitialize(&preconfig);
        if (PyStatus_Exception(status)) { gError = [NSString stringWithFormat:@"Python pre-init failed: %s", status.err_msg ?: "?"]; return gError; }

        PyConfig config;
        PyConfig_InitIsolatedConfig(&config);
        config.buffered_stdio = 0;
        config.write_bytecode = 0;
        config.install_signal_handlers = 0;
        config.site_import = 1;
#if PY_VERSION_HEX >= 0x030E0000
        config.use_system_logger = 1;   // print() goes to the iOS log
#endif
        status = PyConfig_SetBytesString(&config, &config.home, home.UTF8String);
        if (PyStatus_Exception(status)) { PyConfig_Clear(&config); gError = @"Python home could not be set."; return gError; }
        config.module_search_paths_set = 1;
        AppendPath(&config, stdlib);
        AppendPath(&config, [stdlib stringByAppendingPathComponent:@"lib-dynload"]);
        AppendPath(&config, [res stringByAppendingPathComponent:@"aurora_app"]);
        AppendPath(&config, [res stringByAppendingPathComponent:@"app_packages"]);

        status = Py_InitializeFromConfig(&config);
        PyConfig_Clear(&config);
        if (PyStatus_Exception(status)) { gError = [NSString stringWithFormat:@"Python failed to start: %s", status.err_msg ?: "?"]; return gError; }

        gModule = PyImport_ImportModule("aurora_dl");
        if (!gModule) gError = [@"The download engine failed to load:\n" stringByAppendingString:AuroraPyError()];

        // Let other threads (and Python's own download threads) take the GIL.
        PyEval_SaveThread();
        return gError;
    }
}

+ (NSString *)call:(NSString *)function arg:(NSString *)arg {
    NSString *err = [self start];
    if (err) return AuroraJSONError(err);
    PyGILState_STATE g = PyGILState_Ensure();
    NSString *out;
    PyObject *r = PyObject_CallMethod(gModule, function.UTF8String, "s", arg.UTF8String);
    if (!r) {
        out = AuroraJSONError(AuroraPyError());
    } else {
        const char *s = PyUnicode_Check(r) ? PyUnicode_AsUTF8(r) : NULL;
        out = s ? [NSString stringWithUTF8String:s] : @"null";
        if (!s) PyErr_Clear();
        Py_DECREF(r);
    }
    PyGILState_Release(g);
    return out;
}

@end
