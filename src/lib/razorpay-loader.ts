/**
 * Robust client-side loader for Razorpay Checkout SDK.
 * Ensures the script is fully downloaded and window.Razorpay is defined before opening checkout.
 */
export async function ensureRazorpayLoaded(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (window.Razorpay) return true;

  return new Promise((resolve) => {
    let script = document.getElementById("razorpay-sdk") as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = "razorpay-sdk";
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      document.body.appendChild(script);
    }

    const checkInterval = setInterval(() => {
      if (window.Razorpay) {
        clearInterval(checkInterval);
        resolve(true);
      }
    }, 50);

    script.addEventListener(
      "load",
      () => {
        clearInterval(checkInterval);
        resolve(true);
      },
      { once: true }
    );

    script.addEventListener(
      "error",
      () => {
        clearInterval(checkInterval);
        resolve(false);
      },
      { once: true }
    );

    // Timeout safety fallback (8 seconds)
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve(Boolean(window.Razorpay));
    }, 8000);
  });
}
