import unittest

from ledger import Ledger


class HiddenTest(unittest.TestCase):
    def test_rejects_non_positive_deposit(self):
        ledger = Ledger()
        ledger.deposit(5)
        with self.assertRaises(
            ValueError,
            msg="ledger behavior is incomplete: invalid deposit was accepted",
        ):
            ledger.deposit(0)
        with self.assertRaises(
            ValueError,
            msg="ledger behavior is incomplete: negative deposit was accepted",
        ):
            ledger.deposit(-1)
        self.assertEqual(
            ledger.balance,
            5,
            "ledger behavior is incomplete: invalid deposit changed the balance",
        )

    def test_rejects_non_positive_withdrawal(self):
        ledger = Ledger()
        ledger.deposit(5)
        with self.assertRaises(
            ValueError,
            msg="ledger behavior is incomplete: zero withdrawal was accepted",
        ):
            ledger.withdraw(0)
        with self.assertRaises(
            ValueError,
            msg="ledger behavior is incomplete: negative withdrawal was accepted",
        ):
            ledger.withdraw(-1)
        self.assertEqual(ledger.balance, 5)

    def test_allows_exact_balance_withdrawal(self):
        ledger = Ledger()
        ledger.deposit(10)
        self.assertEqual(ledger.withdraw(10), 0)
        self.assertEqual(ledger.balance, 0)

    def test_deposit_and_withdraw_sequence(self):
        ledger = Ledger()
        self.assertEqual(ledger.deposit(20), 20)
        self.assertEqual(ledger.withdraw(7.5), 12.5)
        self.assertEqual(ledger.balance, 12.5)


if __name__ == "__main__":
    unittest.main()
