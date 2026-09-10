/**
 * Template privacy notice. Replace the bracketed items and have it reviewed
 * before launch: in South Africa the Protection of Personal Information Act
 * (POPIA) applies to the names, numbers and locations this app stores.
 */
export function Privacy({ onBack }: { onBack: () => void }) {
  return (
    <div className="login">
      <div className="card" style={{ maxWidth: 760 }}>
        <div className="row">
          <h2>Privacy notice</h2>
          <span className="spacer" />
          <button className="btn small ghost" onClick={onBack}>
            Back
          </button>
        </div>
        <p className="hint">Template. Replace [bracketed] items and have it reviewed before going live.</p>
        <h3>Who we are</h3>
        <p>[Company name], [registration number], [address]. Information officer: [name, email].</p>
        <h3>What we collect</h3>
        <p>
          Your name and mobile number (to sign you in and let a responder reach you); the location you request help at; for responders, your live position while online;
          messages and notes you enter; and technical logs (IP address, device type) needed to run and secure the service.
        </p>
        <h3>Why</h3>
        <p>
          To send the nearest available security, medical or fire unit to you, let you track them, contact you during an incident, keep an audit trail for safety and
          disputes, and improve response times. We process this on the basis of your request for the service and our legitimate interest in safety.
        </p>
        <h3>Who sees it</h3>
        <p>
          Only the unit assigned to your incident and our control room see your details. Responders never see other people's incidents. If you or your organisation
          connected another system (for example an alarm company's platform), incident updates are also sent there. We use [hosting provider, region] to run the
          service and [SMS provider] to send sign-in codes.
        </p>
        <h3>How long</h3>
        <p>Incident records are kept for [24 months] for safety, legal and insurance purposes, then deleted or anonymised. Live location trails are kept for [90 days].</p>
        <h3>Your rights</h3>
        <p>
          You may ask what we hold about you, correct it, or request deletion where we are not legally required to keep it, by contacting [email]. You may complain to
          the Information Regulator (South Africa) at inforeg.org.za.
        </p>
        <h3>Emergencies</h3>
        <p>This service supplements, and does not replace, national emergency numbers. In a life-threatening emergency also call 10111 / 112.</p>
      </div>
    </div>
  );
}
