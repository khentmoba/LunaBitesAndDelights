import 'package:flutter/material.dart';

/// Tracks active routes per [NavigatorState] so navigation helpers can pop
/// back to an existing screen instead of stacking duplicate pages.
class RouteHistoryObserver extends NavigatorObserver {
  final Map<NavigatorState, List<Route<dynamic>>> _stacks = {};

  List<Route<dynamic>> _stackFor(NavigatorState nav) =>
      _stacks.putIfAbsent(nav, () => <Route<dynamic>>[]);

  /// Returns true if [nav] currently holds a route named [routeName].
  bool hasRoute(NavigatorState nav, String routeName) {
    final stack = _stacks[nav];
    if (stack == null) return false;
    return stack.any((r) => r.settings.name == routeName);
  }

  /// Returns true if the top route of [nav] is already named [routeName].
  bool isCurrentRoute(NavigatorState nav, String routeName) {
    final stack = _stacks[nav];
    if (stack == null || stack.isEmpty) return false;
    return stack.last.settings.name == routeName;
  }

  /// Returns true when [route] is the topmost [PageRoute] in [nav], ignoring
  /// transient overlays such as modal bottom sheets or dialogs on top of it.
  /// If [nav] or [route] is not tracked by this observer, falls back to
  /// [route.isCurrent].
  bool isTopPageRoute(NavigatorState nav, Route<dynamic> route) {
    final stack = _stacks[nav];
    if (stack == null || !stack.contains(route)) {
      return route.isCurrent;
    }
    for (int i = stack.length - 1; i >= 0; i--) {
      if (stack[i] is PageRoute) return identical(stack[i], route);
    }
    return identical(stack.last, route);
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    final nav = navigator;
    if (nav == null) return;
    final stack = _stackFor(nav);
    if (previousRoute != null) {
      final idx = stack.indexOf(previousRoute);
      if (idx != -1 && idx + 1 <= stack.length) {
        stack.insert(idx + 1, route);
        return;
      }
    }
    stack.add(route);
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    final nav = navigator;
    if (nav == null) return;
    final stack = _stacks[nav];
    if (stack == null) return;
    stack.remove(route);
    if (stack.isEmpty) _stacks.remove(nav);
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    final nav = navigator;
    if (nav == null) return;
    final stack = _stacks[nav];
    if (stack == null) return;
    stack.remove(route);
    if (stack.isEmpty) _stacks.remove(nav);
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    final nav = navigator;
    if (nav == null) return;
    final stack = _stackFor(nav);
    if (oldRoute != null) {
      final idx = stack.indexOf(oldRoute);
      if (idx != -1) {
        if (newRoute != null) {
          stack[idx] = newRoute;
        } else {
          stack.removeAt(idx);
        }
        if (stack.isEmpty) _stacks.remove(nav);
        return;
      }
    }
    if (newRoute != null) stack.add(newRoute);
  }
}

final RouteHistoryObserver appRouteObserver = RouteHistoryObserver();

/// Pops back to an existing [routeName] in [nav] if one exists; otherwise
/// pushes [fallbackRoute].
void pushOrPopToRoute(
  NavigatorState nav,
  String routeName,
  Route<dynamic> Function() fallbackRoute,
) {
  if (appRouteObserver.isCurrentRoute(nav, routeName)) return;
  if (appRouteObserver.hasRoute(nav, routeName)) {
    nav.popUntil((r) => r.settings.name == routeName);
    return;
  }
  nav.push(fallbackRoute());
}

/// Pops back to an existing [routeName] in [nav] if one exists; otherwise
/// calls [NavigatorState.pushNamed].
void pushNamedOrPopTo(NavigatorState nav, String routeName) {
  if (appRouteObserver.isCurrentRoute(nav, routeName)) return;
  if (appRouteObserver.hasRoute(nav, routeName)) {
    nav.popUntil((r) => r.settings.name == routeName);
    return;
  }
  nav.pushNamed(routeName);
}
