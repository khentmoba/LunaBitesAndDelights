import 'dart:io';

/// Composes the deployed site from two builds:
///
///   /        the hand-written storefront in `site/`
///   /kiosk/  the Flutter ordering app
///
/// Run after `flutter build web --release --base-href /kiosk/`.

void main() {
  final build = Directory('build/web');
  final kiosk = Directory('build/web/kiosk');
  final storefront = Directory('site');

  if (!File('${build.path}/index.html').existsSync()) {
    stderr.writeln(
      'build/web/index.html is missing — run flutter build web first.',
    );
    exit(1);
  }
  if (!File('${storefront.path}/index.html').existsSync()) {
    stderr.writeln('site/index.html is missing.');
    exit(1);
  }

  if (kiosk.existsSync()) kiosk.deleteSync(recursive: true);
  kiosk.createSync(recursive: true);

  for (final entity in build.listSync()) {
    final name = entity.uri.pathSegments.lastWhere((s) => s.isNotEmpty);
    if (name == 'kiosk') continue;
    entity.renameSync('${kiosk.path}${Platform.pathSeparator}$name');
  }

  var copied = 0;
  for (final entity in storefront.listSync(recursive: true)) {
    if (entity is! File) continue;
    final rel = entity.path
        .substring(storefront.path.length + 1)
        .replaceAll('\\', '/');
    if (rel.endsWith('.json') &&
        (rel.startsWith('img/') || rel.startsWith('images/'))) {
      continue;
    }
    final target = '${build.path}/$rel';
    final parent = Directory(File(target).parent.path);
    if (!parent.existsSync()) parent.createSync(recursive: true);
    entity.copySync(target);
    copied++;
  }

  final kioskIndex = File('${kiosk.path}/index.html');
  if (!kioskIndex.readAsStringSync().contains('href="/kiosk/"')) {
    stderr.writeln('kiosk/index.html does not carry the /kiosk/ base href.');
    exit(1);
  }

  stdout.writeln('storefront: ${build.path}/index.html (+$copied files)');
  stdout.writeln('kiosk: ${kiosk.path}/index.html');
}
