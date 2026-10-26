import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'link.dart';
import 'pair_screen.dart';
import 'remote_screen.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  final link = Link();
  await link.load();
  runApp(RemoteApp(link: link));
}

class RemoteApp extends StatelessWidget {
  const RemoteApp({super.key, required this.link});
  final Link link;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Nova TV Remote',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      home: ListenableBuilder(
        listenable: link,
        builder: (context, _) => link.paired ? RemoteScreen(link: link) : PairScreen(link: link),
      ),
    );
  }
}
