import { AUTH } from './constants.js';
import ErrorHandler from './errorHandler.js';

/**
 * Authentication handler
 */
document.addEventListener("DOMContentLoaded", function () {
    const csInterface = new window.CSInterface();

    /**
     * Generate random 6-digit code
     * @returns {number} Random code
     */
    function generateCode() {
        return Math.floor(100000 + Math.random() * 900000);
    }

    /**
     * Rotate longpass for existing session
     * @param {string} longpass - Existing longpass
     * @returns {Promise<boolean>} Success status
     */
    async function rotateLongpass(longpass) {
        try {
            const url = `${AUTH.BASE_URL}/rotate_longpass.php?longpass=${encodeURIComponent(longpass)}`;
            const response = await fetch(url, { cache: 'no-store' });
            const data = await response.json();

            if (data.ok && data.longpass) {
                localStorage.setItem('longpass', data.longpass);
                window.location.href = 'index.html?verified=true';
                return true;
            }

            return false;
        } catch (error) {
            ErrorHandler.handle(error, 'rotateLongpass', null);
            return false;
        }
    }

    /**
     * Start OTP authentication flow
     */
    function startOtpFlow() {
        const code = generateCode();
        const url = `${AUTH.BASE_URL}/index.php?code=${code}`;

        const container = document.getElementById('connection');
        const authFrame = document.getElementById('authFrame');

        if (container && authFrame) {
            // Show link to open in browser (iframe has MySQL connection issues)
            container.innerHTML = `<a id="connectLink" href="#">Cliquez ici</a> pour vous connecter`;
            container.style.display = 'block';
            container.style.cursor = 'pointer';

            const handleClick = (e) => {
                e.preventDefault();
                csInterface.openURLInDefaultBrowser(url);
            };

            container.addEventListener('click', handleClick);

            // Hide iframe for now
            authFrame.style.display = 'none';
        }

        // Start polling for code consumption
        pollForCode(code);
    }

    /**
     * Poll for code consumption
     * @param {number} code - Generated code
     */
    function pollForCode(code) {
        let attempts = 0;
        const maxAttempts = AUTH.MAX_POLLING_ATTEMPTS;

        const interval = setInterval(async () => {
            attempts++;

            try {
                const url = `${AUTH.BASE_URL}/check_code.php?code=${encodeURIComponent(code)}`;
                const response = await fetch(url, { cache: 'no-store' });
                const data = await response.json();

                if (data.found === true && data.longpass) {
                    clearInterval(interval);
                    localStorage.setItem('longpass', data.longpass);
                    window.location.href = 'index.html?verified=true';
                }
            } catch (error) {
                console.error('Poll error:', error);
            }

            if (attempts >= maxAttempts) {
                clearInterval(interval);
                alert("Code non trouvé dans le délai imparti.");
                window.location.href = 'index.html';
            }
        }, AUTH.POLLING_INTERVAL_MS);
    }

    // Check for existing longpass
    const existingLongpass = localStorage.getItem('longpass');

    if (existingLongpass) {
        // Try to rotate existing session
        rotateLongpass(existingLongpass).then(success => {
            if (!success) {
                // Rotation failed, start OTP flow
                startOtpFlow();
            }
        });
    } else {
        // No existing session, start OTP flow
        startOtpFlow();
    }
});
