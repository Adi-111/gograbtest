'use strict'

/**
 * New Relic agent configuration.
 */
exports.config = {
    app_name: ['GoGrab-NestJS'],
    license_key: 'a059864089dbf5ac5d2ecb054ba5fb23FFFFNRAL',
    logging: {
        level: 'info',
    },
    allow_all_headers: true,
    attributes: {
        include: ['request.headers.*', 'response.headers.*'],
    },
}