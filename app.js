(function () {
  const config = window.IDEA_MELT_CONFIG || {};
  const form = document.querySelector("[data-signup-form]");

  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitSignup(form);
  });

  async function submitSignup(signupForm) {
    const emailInput = signupForm.querySelector('input[name="email"]');
    const honeypotInput = signupForm.querySelector('input[name="_gotcha"]');
    const button = signupForm.querySelector("button");

    if (!emailInput || !button) {
      return;
    }

    const email = emailInput.value.trim();
    if (!isValidEmail(email)) {
      setMessage(signupForm, "Hmm. That email looks off.", "error");
      emailInput.focus();
      return;
    }

    const endpoint = getFormspreeEndpoint();
    if (!endpoint) {
      setMessage(signupForm, "Formspree is not wired yet. Replace YOUR_FORM_ID first.", "error");
      return;
    }

    setFormState(signupForm, true);
    setMessage(signupForm, "Adding you...", "neutral");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          _gotcha: honeypotInput ? honeypotInput.value : "",
          source: signupForm.dataset.sourceForm || "github-pages",
        }),
      });

      if (!response.ok) {
        throw new Error("Signup failed. Try again in a moment.");
      }

      signupForm.reset();
      setMessage(signupForm, "Nice. You're on the list.", "success");
    } catch (error) {
      setMessage(signupForm, error.message || "Something snapped. Try again in a minute.", "error");
    } finally {
      setFormState(signupForm, false);
    }
  }

  function getFormspreeEndpoint() {
    const endpoint = typeof config.formspreeEndpoint === "string"
      ? config.formspreeEndpoint.trim()
      : "";

    if (!endpoint || endpoint.includes("YOUR_FORM_ID")) {
      return "";
    }

    return endpoint;
  }

  function setFormState(signupForm, isLoading) {
    const button = signupForm.querySelector("button");
    signupForm.dataset.state = isLoading ? "loading" : "idle";

    if (button) {
      button.disabled = isLoading;
    }
  }

  function setMessage(signupForm, message, tone) {
    const messageElement = signupForm.querySelector("[data-form-message]");
    if (!messageElement) {
      return;
    }

    messageElement.textContent = message;
    messageElement.dataset.tone = tone;
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
  }
})();
