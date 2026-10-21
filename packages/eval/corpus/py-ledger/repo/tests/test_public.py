import unittest

from ledger import Ledger


class PublicTest(unittest.TestCase):
    def test_rejects_overdraft(self):
        ledger = Ledger()
        with self.assertRaises(
            ValueError,
            msg="ledger behavior is incomplete: overdraft was not rejected",
        ):
            ledger.withdraw(10)
        self.assertEqual(ledger.balance, 0)


if __name__ == "__main__":
    unittest.main()
