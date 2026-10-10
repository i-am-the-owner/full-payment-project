import 'package:flutter/material.dart';

import '../../domain/models.dart';

/// Renders a provider-defined [DynamicForm]: text, select, radio and date
/// fields, in the groups the provider put them in. The app knows nothing about
/// which fields a currency or country needs — it draws whatever the backend
/// sends, and checks each value against the provider's own rules (required,
/// length, pattern) as the customer types.
///
/// When a field flagged `refreshOnChange` changes, [onRefresh] is called with
/// the values so far so the caller can fetch the updated form and pass it back
/// in as [form]. Everything already typed is kept; only values for fields that
/// no longer exist are dropped.
class DynamicFormFields extends StatefulWidget {
  const DynamicFormFields({
    required this.form,
    required this.onChanged,
    this.onRefresh,
    this.initialValues = const {},
    this.serverErrors = const {},
    super.key,
  });

  final DynamicForm form;
  final ValueChanged<Map<String, String>> onChanged;
  final ValueChanged<Map<String, String>>? onRefresh;
  final Map<String, String> initialValues;

  /// Problems the provider reported after submitting, by field key.
  final Map<String, String> serverErrors;

  @override
  State<DynamicFormFields> createState() => _DynamicFormFieldsState();
}

class _DynamicFormFieldsState extends State<DynamicFormFields> {
  final Map<String, TextEditingController> _controllers = {};
  late Map<String, String> _values = widget.form.keepKnown(
    widget.initialValues,
  );

  @override
  void didUpdateWidget(DynamicFormFields oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.form, widget.form)) {
      // A refreshed form: keep what was typed for fields that still exist.
      _values = widget.form.keepKnown(_values);
      final known = widget.form.fields.map((f) => f.key).toSet();
      _controllers.removeWhere((key, controller) {
        if (known.contains(key)) return false;
        controller.dispose();
        return true;
      });
    }
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  TextEditingController _controllerFor(String key) => _controllers.putIfAbsent(
    key,
    () => TextEditingController(text: _values[key]),
  );

  void _set(DynamicFormField field, String value) {
    final trimmed = value.trim();
    if (trimmed == (_values[field.key] ?? '')) return;
    setState(() {
      if (trimmed.isEmpty) {
        _values.remove(field.key);
      } else {
        _values[field.key] = trimmed;
      }
    });
    widget.onChanged(Map.of(_values));
    if (field.refreshOnChange) {
      widget.onRefresh?.call(Map.of(_values));
    }
  }

  @override
  Widget build(BuildContext context) {
    final form = widget.form;
    final groupKeys = form.groups.map((g) => g.key).toSet();
    // Fields whose group the provider did not describe still get shown.
    final ungrouped = form.fields
        .where((f) => !groupKeys.contains(f.group))
        .toList(growable: false);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final group in form.groups)
          ..._group(
            context,
            group.label,
            form.fields.where((f) => f.group == group.key),
          ),
        ..._group(context, '', ungrouped),
      ],
    );
  }

  Iterable<Widget> _group(
    BuildContext context,
    String label,
    Iterable<DynamicFormField> fields,
  ) sync* {
    if (fields.isEmpty) return;
    if (label.isNotEmpty) {
      yield Padding(
        padding: const EdgeInsets.only(top: 8, bottom: 8),
        child: Semantics(
          header: true,
          child: Text(label, style: Theme.of(context).textTheme.titleMedium),
        ),
      );
    }
    for (final field in fields) {
      yield Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: field.isSelect
            ? _select(field)
            : field.isRadio
            ? _radio(context, field)
            : field.isDate
            ? _date(context, field)
            : _text(field),
      );
    }
  }

  String _label(DynamicFormField field) =>
      field.required || field.label.toLowerCase().contains('optional')
      ? field.label
      : '${field.label} (optional)';

  Widget _text(DynamicFormField field) => TextFormField(
    key: Key('field_${field.key}'),
    controller: _controllerFor(field.key),
    decoration: InputDecoration(
      labelText: _label(field),
      helperText: field.example == null ? null : 'For example ${field.example}',
      errorText: widget.serverErrors[field.key],
      errorMaxLines: 3,
    ),
    autocorrect: false,
    autovalidateMode: AutovalidateMode.onUserInteraction,
    validator: field.validate,
    onChanged: (value) => _set(field, value),
  );

  Widget _select(DynamicFormField field) => DropdownButtonFormField<String>(
    key: Key('field_${field.key}'),
    initialValue: _values[field.key],
    isExpanded: true,
    decoration: InputDecoration(
      labelText: _label(field),
      errorText: widget.serverErrors[field.key],
    ),
    items: [
      for (final option in field.options)
        DropdownMenuItem(
          value: option.value,
          child: Text(option.label, overflow: TextOverflow.ellipsis),
        ),
    ],
    autovalidateMode: AutovalidateMode.onUserInteraction,
    validator: field.validate,
    onChanged: (value) => _set(field, value ?? ''),
  );

  Widget _radio(BuildContext context, DynamicFormField field) {
    return FormField<String>(
      key: Key('field_${field.key}'),
      initialValue: _values[field.key],
      autovalidateMode: AutovalidateMode.onUserInteraction,
      validator: (_) => field.validate(_values[field.key]),
      builder: (state) {
        final error = widget.serverErrors[field.key] ?? state.errorText;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_label(field), style: Theme.of(context).textTheme.bodyLarge),
            RadioGroup<String>(
              groupValue: _values[field.key],
              onChanged: (value) {
                state.didChange(value);
                _set(field, value ?? '');
              },
              child: Column(
                children: [
                  for (final option in field.options)
                    RadioListTile<String>(
                      key: Key('field_${field.key}_${option.value}'),
                      value: option.value,
                      title: Text(option.label),
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                    ),
                ],
              ),
            ),
            if (error != null) _ErrorLine(error),
          ],
        );
      },
    );
  }

  Widget _date(BuildContext context, DynamicFormField field) {
    final controller = _controllerFor(field.key);
    return TextFormField(
      key: Key('field_${field.key}'),
      controller: controller,
      decoration: InputDecoration(
        labelText: _label(field),
        helperText: 'Year-month-day, for example 1990-04-27',
        errorText: widget.serverErrors[field.key],
        suffixIcon: IconButton(
          icon: const Icon(Icons.calendar_today_outlined),
          tooltip: 'Choose ${field.label} from a calendar',
          onPressed: () async {
            final now = DateTime.now();
            final picked = await showDatePicker(
              context: context,
              initialDate: DateTime.tryParse(controller.text) ?? now,
              firstDate: DateTime(1900),
              lastDate: DateTime(now.year + 20),
            );
            if (picked == null) return;
            String two(int n) => n.toString().padLeft(2, '0');
            final text =
                '${picked.year}-${two(picked.month)}-${two(picked.day)}';
            controller.text = text;
            _set(field, text);
          },
        ),
      ),
      keyboardType: TextInputType.datetime,
      autovalidateMode: AutovalidateMode.onUserInteraction,
      validator: field.validate,
      onChanged: (value) => _set(field, value),
    );
  }
}

class _ErrorLine extends StatelessWidget {
  const _ErrorLine(this.message);
  final String message;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 4),
    child: Semantics(
      liveRegion: true,
      child: Text(
        message,
        style: Theme.of(context).textTheme.bodySmall
            ?.copyWith(color: Theme.of(context).colorScheme.error),
      ),
    ),
  );
}
