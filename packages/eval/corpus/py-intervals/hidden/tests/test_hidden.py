import unittest

from intervals import merge


class HiddenTest(unittest.TestCase):
    def test_merges_adjacent_intervals(self):
        self.assertEqual(
            merge([(1, 2), (2, 3)]),
            [(1, 3)],
            "interval behavior is incomplete: adjacent intervals were not merged",
        )

    def test_sorts_before_merging(self):
        self.assertEqual(
            merge([(5, 6), (1, 2), (2, 3)]),
            [(1, 3), (5, 6)],
            "interval behavior is incomplete: unsorted intervals were not merged",
        )

    def test_contains_nested_interval(self):
        self.assertEqual(
            merge([(1, 10), (2, 3)]),
            [(1, 10)],
            "interval behavior is incomplete: nested interval was not contained",
        )

    def test_empty_input(self):
        self.assertEqual(merge([]), [])

    def test_negative_values(self):
        self.assertEqual(merge([(-5, -2), (-4, 0)]), [(-5, 0)])


if __name__ == "__main__":
    unittest.main()
