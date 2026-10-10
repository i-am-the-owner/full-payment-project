import 'package:flutter/material.dart';

import 'account.dart';
import 'home.dart';
import 'people.dart';
import 'transfers.dart';

/// The signed-in app: Home, People, Transfers, You.
class DemoShell extends StatefulWidget {
  const DemoShell({super.key});

  @override
  State<DemoShell> createState() => DemoShellState();
}

class DemoShellState extends State<DemoShell> {
  int _tab = 0;

  /// Lets a screen deeper in the app jump to a tab.
  void goTo(int tab) => setState(() => _tab = tab);

  static DemoShellState? maybeOf(BuildContext context) =>
      context.findAncestorStateOfType<DemoShellState>();

  @override
  Widget build(BuildContext context) {
    const pages = [HomeTab(), PeopleTab(), TransfersTab(), AccountTab()];
    return Scaffold(
      body: SafeArea(
        child: IndexedStack(index: _tab, children: pages),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: goTo,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.people_outline),
            selectedIcon: Icon(Icons.people),
            label: 'People',
          ),
          NavigationDestination(
            icon: Icon(Icons.confirmation_number_outlined),
            selectedIcon: Icon(Icons.confirmation_number),
            label: 'Transfers',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'You',
          ),
        ],
      ),
    );
  }
}
