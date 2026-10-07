'use strict';


// =============================================================================
// COGNITO CLAIMS
// =============================================================================

function getCognitoClaims(event) {

  /*
   * API Gateway REST API + Cognito Authorizer:
   *
   * event.requestContext.authorizer.claims
   */

  return (
    event.requestContext
      ?.authorizer
      ?.claims ||
    null
  );

}


// =============================================================================
// AUTHENTICATED USER
// =============================================================================

function getAuthenticatedUser(event) {

  const claims =
    getCognitoClaims(event);


  if (!claims) {

    return null;

  }


  const cognitoSub =
    claims.sub;


  if (!cognitoSub) {

    return null;

  }


  /*
   * Cognito groups may be supplied as either an array
   * or a comma-separated string.
   */

  const rawGroups =
    claims['cognito:groups'];


  let groups = [];


  if (Array.isArray(rawGroups)) {

    groups =
      rawGroups;

  } else if (
    typeof rawGroups === 'string'
  ) {

    groups =
      rawGroups
        .split(',')
        .map(
          group =>
            group.trim()
        )
        .filter(Boolean);

  }


  return {

    cognitoSub,

    email:
      claims.email ||
      null,

    groups

  };

}


module.exports = {
  getCognitoClaims,
  getAuthenticatedUser
};
