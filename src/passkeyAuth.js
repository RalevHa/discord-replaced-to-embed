// Passkey (WebAuthn) support for the admin panel — a 2nd factor on top of
// ADMIN_PASSWORD, not a replacement: adminAuth.js's handleLogin only sets
// session.passwordVerified once the password's right, and it's this module's
// handleLoginVerify that turns that into session.authenticated, once a
// registered passkey signs the challenge below. See adminAuth.js for the
// bootstrap case (no passkey registered yet = password alone is enough).
//
// Disabled (all handlers 404) when config.adminPublicUrl is unset — WebAuthn
// needs to know the exact origin/domain up front, there's no sane default.

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { isoBase64URL } = require('@simplewebauthn/server/helpers');

const RP_NAME = 'Bot Admin';
const USER_ID = new TextEncoder().encode('admin');

/** @param {{ config: object, storage: object }} ctx */
function createPasskeyAuth({ config, storage }) {
  const rpID = config.adminPublicUrl ? new URL(config.adminPublicUrl).hostname : null;
  const origin = config.adminPublicUrl || null;

  function enabled() {
    return Boolean(rpID);
  }

  /** Authed — starts "add a passkey" from within the dashboard. */
  async function handleRegisterOptions(req, res) {
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userID: USER_ID,
      userName: 'admin',
      attestationType: 'none',
      excludeCredentials: storage.listPasskeyDescriptors(),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    req.session.currentChallenge = options.challenge;
    res.json(options);
  }

  /** Authed — completes registration and stores the new credential. */
  async function handleRegisterVerify(req, res) {
    const expectedChallenge = req.session.currentChallenge;
    delete req.session.currentChallenge;
    if (!expectedChallenge) {
      res.status(400).json({ error: 'No pending registration — request new options first.' });
      return;
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: req.body?.response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (!verification.verified) {
      res.status(400).json({ error: 'Registration could not be verified.' });
      return;
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const name = String(req.body?.name || 'Passkey').trim().slice(0, 60) || 'Passkey';
    await storage.addPasskey({
      id: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports || [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name,
      createdAt: Date.now(),
    });
    res.json({ ok: true });
  }

  /** Public, but gated on session.passwordVerified — this IS the 2nd login step. */
  async function handleLoginOptions(req, res) {
    if (!req.session.passwordVerified) {
      res.status(401).json({ error: 'Enter the password first.' });
      return;
    }
    const allowCredentials = storage.listPasskeyDescriptors();
    if (!allowCredentials.length) {
      res.status(400).json({ error: 'No passkeys registered.' });
      return;
    }
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'preferred',
    });
    req.session.currentChallenge = options.challenge;
    res.json(options);
  }

  /** Public, same gate — success here is what actually sets session.authenticated. */
  async function handleLoginVerify(req, res) {
    if (!req.session.passwordVerified) {
      res.status(401).json({ error: 'Enter the password first.' });
      return;
    }
    const expectedChallenge = req.session.currentChallenge;
    delete req.session.currentChallenge;
    if (!expectedChallenge) {
      res.status(400).json({ error: 'No pending login — request new options first.' });
      return;
    }

    const credentialId = req.body?.response?.id;
    const stored = credentialId ? storage.getPasskey(credentialId) : null;
    if (!stored) {
      res.status(400).json({ error: 'Unknown passkey.' });
      return;
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: req.body.response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: stored.id,
          publicKey: isoBase64URL.toBuffer(stored.publicKey),
          counter: stored.counter,
          transports: stored.transports,
        },
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (!verification.verified) {
      res.status(400).json({ error: 'Passkey could not be verified.' });
      return;
    }

    await storage.updatePasskeyCounter(stored.id, verification.authenticationInfo.newCounter);
    req.session.passwordVerified = false;
    req.session.authenticated = true;
    res.json({ ok: true });
  }

  /** Authed — list registered passkeys (no key material) for the admin panel. */
  function handleList(req, res) {
    res.json(storage.listPasskeys());
  }

  /** Authed — remove a lost/decommissioned device's passkey. */
  async function handleRemove(req, res) {
    await storage.removePasskey(req.params.id);
    res.json({ ok: true });
  }

  return {
    enabled,
    handleRegisterOptions,
    handleRegisterVerify,
    handleLoginOptions,
    handleLoginVerify,
    handleList,
    handleRemove,
  };
}

module.exports = { createPasskeyAuth };
