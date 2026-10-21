import unittest

from intervals import merge


class PublicTest(unittest.TestCase):
    def test_merges_overlapping_intervals(self):
        self.assertEqual(
            merge([(1, 3), (2, 4)]),
            [(1, 4)],
            "interval behavior is incomplete: overlapping intervals were not merged",
        )


if __name__ == "__main__":
    unittest.main()
