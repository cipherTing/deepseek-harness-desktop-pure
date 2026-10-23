#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

typedef void (*DshBrowserFocusCallback)(void *context);
typedef void (*DshBrowserNavigationFailureCallback)(
    void *context, const char *url, int code, const char *description);
typedef void (*DshBrowserHistoryCallback)(void *context, bool canGoBack,
                                          bool canGoForward, const char *url);
typedef void (*DshBrowserRuleCallback)(void *context, int success, const char *error);

@interface DshBrowserDelegateProxy : NSObject <WKNavigationDelegate, WKUIDelegate>
@property(nonatomic, strong) id<WKNavigationDelegate> originalNavigationDelegate;
@property(nonatomic, strong) id<WKUIDelegate> originalUIDelegate;
@property(nonatomic, strong) WKNavigation *activeNavigation;
@property(nonatomic, copy) NSString *activeURL;
@property(nonatomic, copy) NSString *pendingURL;
@property(nonatomic, assign) DshBrowserNavigationFailureCallback failureCallback;
@property(nonatomic, assign) DshBrowserHistoryCallback historyCallback;
@property(nonatomic, assign) void *context;
@end

@implementation DshBrowserDelegateProxy

- (BOOL)respondsToSelector:(SEL)selector {
  return [super respondsToSelector:selector] ||
         [self.originalNavigationDelegate respondsToSelector:selector] ||
         [self.originalUIDelegate respondsToSelector:selector];
}

- (id)forwardingTargetForSelector:(SEL)selector {
  if ([self.originalNavigationDelegate respondsToSelector:selector]) {
    return self.originalNavigationDelegate;
  }
  if ([self.originalUIDelegate respondsToSelector:selector]) {
    return self.originalUIDelegate;
  }
  return [super forwardingTargetForSelector:selector];
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)action
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  WKFrameInfo *targetFrame = action.targetFrame;
  if (targetFrame != nil && targetFrame.isMainFrame) {
    self.pendingURL = action.request.URL.absoluteString;
  }

  SEL selector = _cmd;
  id delegate = self.originalNavigationDelegate;
  if ([delegate respondsToSelector:selector]) {
    typedef void (*DecisionIMP)(id, SEL, WKWebView *, WKNavigationAction *,
                                void (^)(WKNavigationActionPolicy));
    DecisionIMP implementation = (DecisionIMP)[delegate methodForSelector:selector];
    implementation(delegate, selector, webView, action, decisionHandler);
  } else {
    decisionHandler(WKNavigationActionPolicyAllow);
  }
}

- (void)webView:(WKWebView *)webView didStartProvisionalNavigation:(WKNavigation *)navigation {
  self.activeNavigation = navigation;
  self.activeURL = self.pendingURL ?: webView.URL.absoluteString;
  self.pendingURL = nil;
  [self forwardNavigationCallback:_cmd webView:webView navigation:navigation];
}

- (void)webView:(WKWebView *)webView
    didReceiveServerRedirectForProvisionalNavigation:(WKNavigation *)navigation {
  if (navigation == self.activeNavigation && webView.URL.absoluteString != nil) {
    self.activeURL = webView.URL.absoluteString;
  }
  [self forwardNavigationCallback:_cmd webView:webView navigation:navigation];
}

- (void)webView:(WKWebView *)webView didCommitNavigation:(WKNavigation *)navigation {
  if (navigation == self.activeNavigation && webView.URL.absoluteString != nil) {
    self.activeURL = webView.URL.absoluteString;
  }
  [self forwardNavigationCallback:_cmd webView:webView navigation:navigation];
}

- (void)webView:(WKWebView *)webView
    didFailProvisionalNavigation:(WKNavigation *)navigation
                       withError:(NSError *)error {
  [self reportFailureForNavigation:navigation webView:webView error:error];
  [self forwardNavigationFailure:_cmd webView:webView navigation:navigation error:error];
}

- (void)webView:(WKWebView *)webView
    didFailNavigation:(WKNavigation *)navigation
            withError:(NSError *)error {
  [self reportFailureForNavigation:navigation webView:webView error:error];
  [self forwardNavigationFailure:_cmd webView:webView navigation:navigation error:error];
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  [self forwardNavigationCallback:_cmd webView:webView navigation:navigation];
  if (navigation == self.activeNavigation) {
    self.activeNavigation = nil;
    self.activeURL = nil;
  }
}

- (void)webView:(WKWebView *)webView
    requestMediaCapturePermissionForOrigin:(WKSecurityOrigin *)origin
                         initiatedByFrame:(WKFrameInfo *)frame
                                      type:(WKMediaCaptureType)type
                           decisionHandler:(void (^)(WKPermissionDecision))decisionHandler
    API_AVAILABLE(macos(12.0)) {
  decisionHandler(WKPermissionDecisionDeny);
}

- (void)reportFailureForNavigation:(WKNavigation *)navigation
                           webView:(WKWebView *)webView
                             error:(NSError *)error {
  if (navigation != self.activeNavigation) {
    return;
  }

  NSString *url = self.activeURL ?: webView.URL.absoluteString ?: @"";
  if (self.failureCallback != NULL) {
    self.failureCallback(self.context, url.UTF8String, (int)error.code,
                         error.localizedDescription.UTF8String);
  }
  self.activeNavigation = nil;
  self.activeURL = nil;
}

- (void)forwardNavigationCallback:(SEL)selector
                           webView:(WKWebView *)webView
                        navigation:(WKNavigation *)navigation {
  id delegate = self.originalNavigationDelegate;
  if (![delegate respondsToSelector:selector]) {
    return;
  }
  typedef void (*NavigationIMP)(id, SEL, WKWebView *, WKNavigation *);
  NavigationIMP implementation = (NavigationIMP)[delegate methodForSelector:selector];
  implementation(delegate, selector, webView, navigation);
}

- (void)forwardNavigationFailure:(SEL)selector
                          webView:(WKWebView *)webView
                       navigation:(WKNavigation *)navigation
                            error:(NSError *)error {
  id delegate = self.originalNavigationDelegate;
  if (![delegate respondsToSelector:selector]) {
    return;
  }
  typedef void (*NavigationFailureIMP)(id, SEL, WKWebView *, WKNavigation *, NSError *);
  NavigationFailureIMP implementation = (NavigationFailureIMP)[delegate methodForSelector:selector];
  implementation(delegate, selector, webView, navigation, error);
}

@end

@class DshBrowserHook;

@interface DshBrowserHistoryHandler : NSObject <WKScriptMessageHandler>
@property(nonatomic, weak) DshBrowserHook *hook;
@end

@interface DshBrowserHook : NSObject
@property(nonatomic, weak) WKWebView *webView;
@property(nonatomic, strong) DshBrowserDelegateProxy *proxy;
@property(nonatomic, strong) id eventMonitor;
@property(nonatomic, strong) id windowObserver;
@property(nonatomic, strong) WKContentRuleList *currentRuleList;
@property(nonatomic, strong) DshBrowserHistoryHandler *historyHandler;
@property(nonatomic, strong) WKUserScript *historyScript;
@property(nonatomic, assign) DshBrowserFocusCallback focusCallback;
@property(nonatomic, assign) DshBrowserHistoryCallback historyCallback;
@property(nonatomic, assign) void *context;
@property(nonatomic, assign) BOOL firstResponderWasInside;
@end

@implementation DshBrowserHistoryHandler

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
  DshBrowserHook *hook = self.hook;
  WKWebView *webView = hook.webView;
  if (webView == nil || hook.historyCallback == NULL) {
    return;
  }
  hook.historyCallback(hook.context, webView.canGoBack, webView.canGoForward,
                       webView.URL.absoluteString.UTF8String);
}

@end

static BOOL DshViewIsInsideView(NSView *view, NSView *ancestor) {
  for (NSView *current = view; current != nil; current = current.superview) {
    if (current == ancestor) {
      return YES;
    }
  }
  return NO;
}

@implementation DshBrowserHook

- (void)installOnWebView:(WKWebView *)webView
          focusCallback:(DshBrowserFocusCallback)focusCallback
       failureCallback:(DshBrowserNavigationFailureCallback)failureCallback
        historyCallback:(DshBrowserHistoryCallback)historyCallback
                context:(void *)context {
  self.webView = webView;
  self.focusCallback = focusCallback;
  self.historyCallback = historyCallback;
  self.context = context;

  DshBrowserDelegateProxy *proxy = [DshBrowserDelegateProxy new];
  proxy.originalNavigationDelegate = webView.navigationDelegate;
  proxy.originalUIDelegate = webView.UIDelegate;
  proxy.failureCallback = failureCallback;
  proxy.historyCallback = historyCallback;
  proxy.context = context;
  self.proxy = proxy;
  webView.navigationDelegate = proxy;
  webView.UIDelegate = proxy;

  WKUserContentController *contentController = webView.configuration.userContentController;
  self.historyHandler = [DshBrowserHistoryHandler new];
  self.historyHandler.hook = self;
  [contentController addScriptMessageHandler:self.historyHandler name:@"dshBrowserHistory"];
  NSString *historySource =
      @"(() => {"
       "const notify = () => { try { window.webkit.messageHandlers.dshBrowserHistory.postMessage(location.href); } catch (_) {} };"
       "for (const method of ['pushState', 'replaceState']) {"
       "const original = history[method];"
       "history[method] = function(...args) { const result = Reflect.apply(original, this, args); notify(); return result; };"
       "}"
       "addEventListener('popstate', notify);"
       "addEventListener('hashchange', notify);"
       "})();";
  self.historyScript = [[WKUserScript alloc] initWithSource:historySource
                                              injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                           forMainFrameOnly:YES];
  [contentController addUserScript:self.historyScript];

  __weak DshBrowserHook *weakSelf = self;
  NSEventMask mouseDownMask = NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown |
                             NSEventMaskOtherMouseDown;
  self.eventMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:mouseDownMask
                                                            handler:^NSEvent *(NSEvent *event) {
    DshBrowserHook *strongSelf = weakSelf;
    WKWebView *guest = strongSelf.webView;
    if (guest != nil && event.window == guest.window) {
      NSView *contentView = event.window.contentView;
      NSPoint point = [contentView convertPoint:event.locationInWindow fromView:nil];
      NSView *hitView = [contentView hitTest:point];
      if (hitView != nil && DshViewIsInsideView(hitView, guest)) {
        [strongSelf notifyFocus];
      }
    }
    return event;
  }];

  NSWindow *window = webView.window;
  if (window != nil) {
    __weak NSWindow *weakWindow = window;
    self.windowObserver = [[NSNotificationCenter defaultCenter]
        addObserverForName:NSWindowDidUpdateNotification
                    object:window
                     queue:nil
                usingBlock:^(__unused NSNotification *notification) {
      DshBrowserHook *strongSelf = weakSelf;
      WKWebView *guest = strongSelf.webView;
      NSWindow *observedWindow = weakWindow;
      if (guest == nil || observedWindow == nil) {
        return;
      }
      NSResponder *responder = observedWindow.firstResponder;
      BOOL isInside = [responder isKindOfClass:[NSView class]] &&
                      DshViewIsInsideView((NSView *)responder, guest);
      if (isInside != strongSelf.firstResponderWasInside) {
        strongSelf.firstResponderWasInside = isInside;
        if (isInside) {
          [strongSelf notifyFocus];
        }
      }
    }];
  }
}

- (void)notifyFocus {
  if (self.focusCallback != NULL) {
    self.focusCallback(self.context);
  }
}

- (void)remove {
  WKWebView *webView = self.webView;
  if (webView != nil) {
    if (webView.navigationDelegate == self.proxy) {
      webView.navigationDelegate = self.proxy.originalNavigationDelegate;
    }
    if (webView.UIDelegate == self.proxy) {
      webView.UIDelegate = self.proxy.originalUIDelegate;
    }
    if (self.currentRuleList != nil) {
      [webView.configuration.userContentController removeContentRuleList:self.currentRuleList];
      self.currentRuleList = nil;
    }
    [webView.configuration.userContentController removeScriptMessageHandlerForName:@"dshBrowserHistory"];
  }
  if (self.eventMonitor != nil) {
    [NSEvent removeMonitor:self.eventMonitor];
    self.eventMonitor = nil;
  }
  if (self.windowObserver != nil) {
    [[NSNotificationCenter defaultCenter] removeObserver:self.windowObserver];
    self.windowObserver = nil;
  }
  self.proxy.failureCallback = NULL;
  self.proxy.historyCallback = NULL;
  self.proxy.context = NULL;
  self.historyCallback = NULL;
  self.focusCallback = NULL;
  self.context = NULL;
  self.webView = nil;
}

- (void)dealloc {
  [self remove];
}

@end

void *dsh_browser_install_hooks(WKWebView *webView,
                                DshBrowserFocusCallback focusCallback,
                                DshBrowserNavigationFailureCallback failureCallback,
                                DshBrowserHistoryCallback historyCallback,
                                void *context) {
  if (webView == nil) {
    return NULL;
  }
  DshBrowserHook *hook = [DshBrowserHook new];
  [hook installOnWebView:webView
          focusCallback:focusCallback
       failureCallback:failureCallback
        historyCallback:historyCallback
                context:context];
  return (__bridge_retained void *)hook;
}

void dsh_browser_navigation_state(WKWebView *webView, bool *canGoBack,
                                  bool *canGoForward) {
  if (webView == nil || canGoBack == NULL || canGoForward == NULL) {
    return;
  }
  *canGoBack = webView.canGoBack;
  *canGoForward = webView.canGoForward;
}

bool dsh_browser_navigate_history(WKWebView *webView, bool back) {
  if (webView == nil) {
    return false;
  }
  if (back) {
    return webView.canGoBack && [webView goBack] != nil;
  }
  return webView.canGoForward && [webView goForward] != nil;
}

void dsh_browser_remove_hooks(void *opaqueHook) {
  if (opaqueHook == NULL) {
    return;
  }
  DshBrowserHook *hook = (__bridge_transfer DshBrowserHook *)opaqueHook;
  if (NSThread.isMainThread) {
    [hook remove];
  } else {
    dispatch_sync(dispatch_get_main_queue(), ^{
      [hook remove];
    });
  }
}

static void DshBrowserCompleteRule(DshBrowserRuleCallback callback,
                                   void *context,
                                   BOOL success,
                                   NSError *error) {
  if (callback == NULL) {
    return;
  }
  callback(context, success ? 1 : 0, error.localizedDescription.UTF8String);
}

static void DshBrowserInstallLoopbackBlockRule(DshBrowserHook *hook,
                                              const char *identifierValue,
                                              const char *encodedRulesValue,
                                              DshBrowserRuleCallback callback,
                                              void *context) {
  if (hook == nil || identifierValue == NULL || encodedRulesValue == NULL) {
    NSError *error = [NSError errorWithDomain:@"DeepDiveBrowser"
                                         code:1
                                     userInfo:@{NSLocalizedDescriptionKey:
                                                    @"Browser rule installation received a null argument"}];
    DshBrowserCompleteRule(callback, context, NO, error);
    return;
  }

  NSString *identifier = [NSString stringWithUTF8String:identifierValue];
  NSString *encodedRules = [NSString stringWithUTF8String:encodedRulesValue];
  if (identifier.length == 0 || encodedRules.length == 0) {
    NSError *error = [NSError errorWithDomain:@"DeepDiveBrowser"
                                         code:2
                                     userInfo:@{NSLocalizedDescriptionKey:
                                                    @"Browser rule identifier and rules must be non-empty UTF-8"}];
    DshBrowserCompleteRule(callback, context, NO, error);
    return;
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    WKWebView *guest = hook.webView;
    if (guest == nil) {
      NSError *error = [NSError errorWithDomain:@"DeepDiveBrowser"
                                           code:3
                                       userInfo:@{NSLocalizedDescriptionKey:
                                                      @"Browser guest closed before its rule was installed"}];
      DshBrowserCompleteRule(callback, context, NO, error);
      return;
    }

    [[WKContentRuleListStore defaultStore]
        compileContentRuleListForIdentifier:identifier
                    encodedContentRuleList:encodedRules
                         completionHandler:^(WKContentRuleList *ruleList, NSError *error) {
      dispatch_async(dispatch_get_main_queue(), ^{
        WKWebView *currentGuest = hook.webView;
        if (error != nil || ruleList == nil || currentGuest == nil) {
          NSError *failure = error;
          if (failure == nil) {
            failure = [NSError errorWithDomain:@"DeepDiveBrowser"
                                          code:4
                                      userInfo:@{NSLocalizedDescriptionKey:
                                                     currentGuest == nil ? @"Browser guest closed before its rule was installed"
                                                                         : @"WebKit returned no compiled browser rule"}];
          }
          DshBrowserCompleteRule(callback, context, NO, failure);
          return;
        }

        WKUserContentController *controller = currentGuest.configuration.userContentController;
        [controller addContentRuleList:ruleList];
        hook.currentRuleList = ruleList;
        DshBrowserCompleteRule(callback, context, YES, nil);
      });
    }];
  });
}

void dsh_browser_install_loopback_block_rule(void *opaqueHook,
                                             const char *identifierValue,
                                             const char *encodedRulesValue,
                                             DshBrowserRuleCallback callback,
                                             void *context) {
  DshBrowserHook *hook = opaqueHook == NULL ? nil : (__bridge DshBrowserHook *)opaqueHook;
  DshBrowserInstallLoopbackBlockRule(hook, identifierValue, encodedRulesValue, callback, context);
}

typedef bool (*DshKeyboardInputCallback)(void *context, unsigned short keyCode,
                                         const char *characters, unsigned char eventKind,
                                         unsigned char modifiers, bool repeat,
                                         bool composing);
typedef void (*DshKeyboardResetCallback)(void *context);

@interface DshKeyboardHook : NSObject
@property(nonatomic, weak) WKWebView *webView;
@property(nonatomic, strong) id eventMonitor;
@property(nonatomic, strong) id windowUpdateObserver;
@property(nonatomic, strong) id windowResignObserver;
@property(nonatomic, assign) DshKeyboardInputCallback inputCallback;
@property(nonatomic, assign) DshKeyboardResetCallback resetCallback;
@property(nonatomic, assign) void *context;
@property(nonatomic, assign) BOOL wasFocused;
@end

static WKWebView *DshNearestWebView(NSResponder *responder) {
  if (![responder isKindOfClass:[NSView class]]) {
    return nil;
  }
  for (NSView *view = (NSView *)responder; view != nil; view = view.superview) {
    if ([view isKindOfClass:[WKWebView class]]) {
      return (WKWebView *)view;
    }
  }
  return nil;
}

static BOOL DshKeyboardViewHasMarkedText(NSResponder *responder) {
  if (![responder conformsToProtocol:@protocol(NSTextInputClient)]) {
    return NO;
  }
  return [(id<NSTextInputClient>)responder hasMarkedText];
}

@implementation DshKeyboardHook

- (void)installOnWebView:(WKWebView *)webView
           inputCallback:(DshKeyboardInputCallback)inputCallback
           resetCallback:(DshKeyboardResetCallback)resetCallback
                 context:(void *)context {
  self.webView = webView;
  self.inputCallback = inputCallback;
  self.resetCallback = resetCallback;
  self.context = context;
  self.wasFocused = [self ownsKeyboardFocus];

  __weak DshKeyboardHook *weakSelf = self;
  NSEventMask keyboardMask = NSEventMaskKeyDown | NSEventMaskKeyUp |
                             NSEventMaskFlagsChanged;
  self.eventMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:keyboardMask
                                                            handler:^NSEvent *(NSEvent *event) {
    DshKeyboardHook *strongSelf = weakSelf;
    if (strongSelf == nil) {
      return event;
    }
    [strongSelf resetIfFocusWasLost];
    WKWebView *target = strongSelf.webView;
    NSWindow *window = target.window;
    if (target == nil || window == nil || event.window != window ||
        ![strongSelf ownsKeyboardFocus]) {
      return event;
    }

    unsigned char eventKind = 0;
    switch (event.type) {
      case NSEventTypeKeyDown:
        eventKind = 1;
        break;
      case NSEventTypeKeyUp:
        eventKind = 2;
        break;
      case NSEventTypeFlagsChanged:
        eventKind = 3;
        break;
      default:
        return event;
    }

    NSEventModifierFlags flags = event.modifierFlags;
    unsigned char modifiers = 0;
    if ((flags & NSEventModifierFlagControl) != 0) modifiers |= 0b0001;
    if ((flags & NSEventModifierFlagOption) != 0) modifiers |= 0b0010;
    if ((flags & NSEventModifierFlagShift) != 0) modifiers |= 0b0100;
    if ((flags & NSEventModifierFlagCommand) != 0) modifiers |= 0b1000;

    NSResponder *firstResponder = window.firstResponder;
    BOOL composing = DshKeyboardViewHasMarkedText(firstResponder);
    NSString *characters = event.characters;
    const char *utf8Characters = characters.UTF8String;
    BOOL consume = strongSelf.inputCallback != NULL &&
                   strongSelf.inputCallback(strongSelf.context, event.keyCode,
                                            utf8Characters, eventKind, modifiers,
                                            [event isARepeat], composing);
    return consume ? nil : event;
  }];

  NSWindow *window = webView.window;
  if (window != nil) {
    self.windowUpdateObserver = [[NSNotificationCenter defaultCenter]
        addObserverForName:NSWindowDidUpdateNotification
                    object:window
                     queue:nil
                usingBlock:^(__unused NSNotification *notification) {
      [weakSelf resetIfFocusWasLost];
    }];
    self.windowResignObserver = [[NSNotificationCenter defaultCenter]
        addObserverForName:NSWindowDidResignKeyNotification
                    object:window
                     queue:nil
                usingBlock:^(__unused NSNotification *notification) {
      DshKeyboardHook *strongSelf = weakSelf;
      if (strongSelf.wasFocused && strongSelf.resetCallback != NULL) {
        strongSelf.resetCallback(strongSelf.context);
      }
      strongSelf.wasFocused = NO;
    }];
  }
}

- (BOOL)ownsKeyboardFocus {
  WKWebView *webView = self.webView;
  NSWindow *window = webView.window;
  return webView != nil && window != nil && [NSApp isActive] && [window isKeyWindow] &&
         DshNearestWebView(window.firstResponder) == webView;
}

- (void)resetIfFocusWasLost {
  BOOL focused = [self ownsKeyboardFocus];
  if (self.wasFocused && !focused && self.resetCallback != NULL) {
    self.resetCallback(self.context);
  }
  self.wasFocused = focused;
}

- (void)remove {
  if (self.eventMonitor != nil) {
    [NSEvent removeMonitor:self.eventMonitor];
    self.eventMonitor = nil;
  }
  NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
  if (self.windowUpdateObserver != nil) {
    [center removeObserver:self.windowUpdateObserver];
    self.windowUpdateObserver = nil;
  }
  if (self.windowResignObserver != nil) {
    [center removeObserver:self.windowResignObserver];
    self.windowResignObserver = nil;
  }
  self.inputCallback = NULL;
  self.resetCallback = NULL;
  self.context = NULL;
  self.webView = nil;
}

- (void)dealloc {
  [self remove];
}

@end

static void *DshKeyboardInstallOnMain(WKWebView *webView,
                                      DshKeyboardInputCallback inputCallback,
                                      DshKeyboardResetCallback resetCallback,
                                      void *context) {
  if (webView == nil || inputCallback == NULL || resetCallback == NULL) {
    return NULL;
  }
  DshKeyboardHook *hook = [DshKeyboardHook new];
  [hook installOnWebView:webView
           inputCallback:inputCallback
           resetCallback:resetCallback
                 context:context];
  if (hook.eventMonitor == nil) {
    [hook remove];
    return NULL;
  }
  return (__bridge_retained void *)hook;
}

void *dsh_keyboard_install_hooks(WKWebView *webView,
                                DshKeyboardInputCallback inputCallback,
                                DshKeyboardResetCallback resetCallback,
                                void *context) {
  if (NSThread.isMainThread) {
    return DshKeyboardInstallOnMain(webView, inputCallback, resetCallback, context);
  }
  __block void *hook = NULL;
  dispatch_sync(dispatch_get_main_queue(), ^{
    hook = DshKeyboardInstallOnMain(webView, inputCallback, resetCallback, context);
  });
  return hook;
}

static void DshKeyboardRemoveOnMain(void *opaqueHook) {
  if (opaqueHook == NULL) {
    return;
  }
  DshKeyboardHook *hook = (__bridge_transfer DshKeyboardHook *)opaqueHook;
  [hook remove];
}

void dsh_keyboard_remove_hooks(void *opaqueHook) {
  if (NSThread.isMainThread) {
    DshKeyboardRemoveOnMain(opaqueHook);
  } else {
    dispatch_sync(dispatch_get_main_queue(), ^{
      DshKeyboardRemoveOnMain(opaqueHook);
    });
  }
}
