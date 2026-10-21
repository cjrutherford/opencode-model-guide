import unittest

from template import render


class PublicTest(unittest.TestCase):
    def test_missing_key_raises(self):
        with self.assertRaises(
            KeyError,
            msg="template behavior is incomplete: missing key was not rejected",
        ) as context:
            render("Hi {{name}}", {})

        self.assertEqual(context.exception.args[0], "name")


if __name__ == "__main__":
    unittest.main()
