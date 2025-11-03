// Helper functions for activity display
function getActivityIcon(action) {
    const icons = {
        'login': 'sign-in-alt',
        'logout': 'sign-out-alt',
        'create': 'plus-circle',
        'update': 'edit',
        'delete': 'trash',
        'upload': 'upload',
        'download': 'download',
        'view': 'eye',
        'grade': 'check-circle',
        'submit': 'paper-plane',
        'account': 'user-circle',
        'accessed': 'user-check'
    };
    return icons[action.toLowerCase()] || 'history';
}

function getActivityBadgeColor(type) {
    const colors = {
        'system': 'success',
        'user': 'primary',
        'login': 'info',
        'warning': 'warning',
        'error': 'danger'
    };
    return colors[type] || 'secondary';
}

module.exports = {
    getActivityIcon,
    getActivityBadgeColor
};