import unittest

from template import render


class HiddenTest(unittest.TestCase):
    def test_supports_whitespace_inside_placeholder(self):
        self.assertEqual(
            render("Hi {{ name }}", {"name": "Ada"}),
            "Hi Ada",
            "template behavior is incomplete: whitespace placeholder was not rendered",
        )

    def test_renders_each_placeholder(self):
        self.assertEqual(
            render("{{greeting}}, {{name}}!", {"greeting": "Hello", "name": "Ada"}),
            "Hello, Ada!",
        )

    def test_missing_key_is_an_error(self):
        with self.assertRaises(
            KeyError,
            msg="template behavior is incomplete: missing key was not rejected",
        ) as context:
            render("{{ missing }}", {})
        self.assertEqual(
            context.exception.args[0],
            "missing",
            "template behavior is incomplete: missing key did not raise",
        )

    def test_malformed_placeholder_is_an_error(self):
        with self.assertRaises(ValueError):
            render("Hello {{name", {"name": "Ada"})
        with self.assertRaises(ValueError):
            render("Hello name}}", {"name": "Ada"})

    def test_values_containing_braces_are_left_intact(self):
        self.assertEqual(render("{{value}}", {"value": "{{raw}}"}).__str__(), "{{raw}}")

    def test_no_placeholder(self):
        self.assertEqual(render("plain text", {}), "plain text")


if __name__ == "__main__":
    unittest.main()
