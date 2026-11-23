/* ClicToPay (SMT) card gateway — the only two calls we need.
   Off until the restaurant's merchant keys are set as secrets:
     CLICTOPAY_USER, CLICTOPAY_PASSWORD, and CLICTOPAY_TEST=1 for the sandbox.
   Amounts go to the gateway in millimes (TND has 3 decimals), currency 788. */

const base = () => process.env.CLICTOPAY_TEST === "1"
  ? "https://test.clictopay.com/payment/rest"
  : "https://ipay.clictopay.com/payment/rest";

export const enabled = () => !!(process.env.CLICTOPAY_USER && process.env.CLICTOPAY_PASSWORD);

async function call(path, params) {
  const body = new URLSearchParams({
    userName: process.env.CLICTOPAY_USER, password: process.env.CLICTOPAY_PASSWORD, ...params,
  });
  const res = await fetch(`${base()}/${path}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  });
  return res.json();
}

/* → { orderId, formUrl } or throws with the gateway's message */
export async function register({ orderNumber, amount, returnUrl, description, language }) {
  const d = await call("register.do", {
    orderNumber, amount: String(Math.round(Number(amount) * 1000)), currency: "788",
    returnUrl, failUrl: returnUrl, description: description || "", language: language || "fr",
  });
  if (!d || !d.formUrl || !d.orderId) throw new Error((d && (d.errorMessage || d.errorCode)) || "clictopay register");
  return { orderId: d.orderId, formUrl: d.formUrl };
}

/* true only when the gateway itself says the card was charged.
   ponytail: OrderStatus 2 = "deposited" on this gateway family (RBS/BPC);
   confirm on the first sandbox payment, then nothing else to change. */
export async function isPaid(orderId) {
  const d = await call("getOrderStatus.do", { orderId });
  const err = String(d && (d.ErrorCode ?? d.errorCode));
  const st = Number(d && (d.OrderStatus ?? d.orderStatus));
  return err === "0" && st === 2;
}
