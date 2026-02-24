/**
 * Collapsible sections handler
 */
(function() {
    let initialized = false;

    function handleCollapsibleClick(event) {
        console.log('Click detected on:', event.target);

        // Find the collapsible button (could be the target itself or a parent)
        let button = event.target;

        // If we clicked on a child element (like an img), find the parent button
        if (!button.classList.contains("collapsible")) {
            button = button.closest(".collapsible");
            console.log('Found parent collapsible button:', button);
        }

        // If we still don't have a collapsible button, return
        if (!button) {
            return;
        }

        const content = button.parentElement.nextElementSibling;
        console.log('Content element:', content);

        if (!content) {
            console.warn('No collapsible content found for button:', button);
            return;
        }

        // Toggle content visibility
        const isVisible = content.style.display === "block";
        console.log('Is visible?', isVisible, '- Toggling...');

        if (isVisible) {
            content.style.display = "none";
            button.classList.remove("active");
            console.log('Collapsed');
        } else {
            content.style.display = "block";
            button.classList.add("active");
            console.log('Expanded');
        }
    }

    function initCollapsibles() {
        if (initialized) {
            console.log('Collapsibles already initialized');
            return;
        }
        initialized = true;

        console.log('Initializing collapsibles...');

        // Use event delegation for better performance
        document.body.addEventListener("click", handleCollapsibleClick);

        // Initialize all collapsibles as collapsed
        const collapsibles = document.querySelectorAll(".collapsible");
        console.log('Found', collapsibles.length, 'collapsible buttons');

        collapsibles.forEach(button => {
            const content = button.parentElement.nextElementSibling;
            if (content && !button.classList.contains("active")) {
                content.style.display = "none";
                console.log('Initialized collapsible:', button.parentElement);
            }
        });
    }

    // Execute immediately if DOM is already loaded, otherwise wait for DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCollapsibles);
    } else {
        initCollapsibles();
    }
})();
