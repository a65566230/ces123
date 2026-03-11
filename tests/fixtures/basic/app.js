window.basicFixture = {
  sign(payload) {
    return btoa(JSON.stringify(payload));
  },
};

document.querySelector('#action').addEventListener('click', () => {
  window.__buttonClicked = true;
});

fetch('/api/sign', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: 'Bearer fixture-token',
  },
  body: JSON.stringify({
    nonce: 'fixture-nonce',
    timestamp: Date.now(),
    signature: window.basicFixture.sign({ nonce: 'fixture-nonce' }),
  }),
})
  .then((response) => response.json())
  .then((payload) => {
    window.__lastSignResponse = payload;
    console.log('fixture-sign-response', payload.signature);
  });
