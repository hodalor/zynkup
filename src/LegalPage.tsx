import './LegalPage.css';

const PRIVACY_PATHS = new Set(['/privacy', '/pryvacy']);
const TERMS_PATH = '/tandc';
const DELETE_PATH = '/delete';

export function isLegalPath(path: string) {
  return PRIVACY_PATHS.has(path) || path === TERMS_PATH || path === DELETE_PATH;
}

type LegalPageProps = {
  path: string;
};

export default function LegalPage({ path }: LegalPageProps) {
  const page = path === TERMS_PATH ? 'terms' : path === DELETE_PATH ? 'delete' : 'privacy';
  return (
    <main className="legal">
      <header className="legal-top">
        <a className="legal-brand" href="/">ZynkUp</a>
        <nav className="legal-nav">
          <a href="/privacy" aria-current={page === 'privacy' ? 'page' : undefined}>Privacy</a>
          <a href="/tandc" aria-current={page === 'terms' ? 'page' : undefined}>Terms</a>
          <a href="/delete" aria-current={page === 'delete' ? 'page' : undefined}>Delete account</a>
        </nav>
      </header>
      <article className="legal-card">
        {page === 'terms' ? <Terms /> : page === 'delete' ? <DeleteAccount /> : <Privacy />}
      </article>
    </main>
  );
}

function Privacy() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p className="legal-meta">Last updated 7 November 2026</p>
      <p>
        Prynova provides ZynkUp. This policy explains what the app collects and how that information is used.
        It covers the ZynkUp phone app and the ZynkUp website.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>Your phone number and name, so we can create your account.</li>
        <li>Your PIN, stored only as a hash, so you can unlock the app.</li>
        <li>Your profile photo, and the messages, photos, video, and audio you choose to send.</li>
        <li>Contacts you choose to upload, so we can show you people who are already on ZynkUp.</li>
        <li>A device id and a push token, so calls and messages can reach this phone.</li>
        <li>A place you attach to a marketplace listing.</li>
      </ul>
      <h2>How we use it</h2>
      <p>
        We use this information to run chat, voice and video calls, status, the marketplace, and linked web
        sessions. A phone can have up to four linked browsers. A new install of your number asks for a code
        by SMS, then your PIN.
      </p>
      <h2>Who can see it</h2>
      <p>
        Messages, calls, status posts, and marketplace listings are shown to the people you contact or the
        audience you choose. We do not sell your data. Services that send SMS codes and push notifications
        process that data for us so the app can work.
      </p>
      <h2>How it is sent and kept</h2>
      <p>
        Data is sent over HTTPS. We keep it while your account is open. To remove your account, follow
        the steps on the <a href="/delete">delete account</a> page.
      </p>
      <h2>Children</h2>
      <p>ZynkUp is for people 18 and older. We do not aim the app at children.</p>
      <h2>Changes</h2>
      <p>When this policy changes, the date at the top of this page changes with it.</p>
    </>
  );
}

function DeleteAccount() {
  return (
    <>
      <h1>Delete your account</h1>
      <p className="legal-meta">Last updated 7 November 2026</p>
      <p>
        You can ask ZynkUp to delete your account from the phone app. Deleting the account removes the
        profile tied to your phone number, including your name, photo, messages, status posts, and
        marketplace listings stored with that account.
      </p>
      <h2>Steps in the app</h2>
      <ol>
        <li>Open ZynkUp and enter your PIN if the app asks for it.</li>
        <li>On Chats, tap the settings icon in the top corner.</li>
        <li>Tap Account. The row says “Security, phone number, delete account”. Tapping your profile at the top opens the same screen.</li>
        <li>Scroll to the bottom of Account.</li>
        <li>Tap Delete my account.</li>
        <li>In the Delete account? dialog, tap OK.</li>
      </ol>
      <h2>What the app does today</h2>
      <p>
        The dialog confirms your request and tells you that account deletion will be available once server
        purge is enabled. Contact support for now. Your request is the start of deletion. The account stays
        in place until that purge runs. Logging out of this phone, or tapping Log out on a linked web
        device, only signs that device out. It does not delete the account.
      </p>
      <h2>If you cannot open the app</h2>
      <p>
        Send the phone number on the account to the support address shown in ZynkUp, and ask for the
        account to be deleted. We use that number to find the right account.
      </p>
    </>
  );
}

function Terms() {
  return (
    <>
      <h1>Terms of use</h1>
      <p className="legal-meta">Last updated 7 November 2026</p>
      <p>
        These terms cover your use of ZynkUp, provided by Prynova, on the phone app and on the website.
        By creating an account or continuing to use ZynkUp, you agree to them.
      </p>
      <h2>Your account</h2>
      <p>
        You need a phone number you control. Keep your PIN to yourself. You are responsible for activity
        on your account. ZynkUp is for people 18 and older.
      </p>
      <h2>How to use ZynkUp</h2>
      <p>
        Use chat, calls, status, and the marketplace for lawful personal use. Do not harass, threaten, spam,
        or impersonate someone else. Do not post anything illegal, including anything that exploits a child.
        Do not try to break, scrape, or overload the service.
      </p>
      <h2>Your content</h2>
      <p>
        You keep ownership of the messages, photos, and listings you post. You give ZynkUp permission to
        store and deliver that content to the people you send it to, for as long as your account is open.
      </p>
      <h2>Marketplace</h2>
      <p>
        Listings are between the people who post them and the people who respond. ZynkUp does not hold
        money, complete a sale, or guarantee an item. Check who you are dealing with before you pay anyone.
      </p>
      <h2>The service</h2>
      <p>
        ZynkUp is provided as available. Calls and messages depend on your connection and the other
        person's phone. We can suspend an account that breaks these terms, and we can change or stop
        features.
      </p>
      <h2>Liability</h2>
      <p>
        To the extent the law allows, Prynova is not liable for loss caused by another user's content,
        a failed call or message, or a marketplace deal you make with someone else.
      </p>
      <h2>Contact</h2>
      <p>Questions about these terms can be sent to the support address shown in the ZynkUp app.</p>
    </>
  );
}
