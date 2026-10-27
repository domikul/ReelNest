package com.reelnest.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/auth")
public class AuthenticationController {

    private final AuthenticationManager authenticationManager;
    private final AccountRegistrationService accountRegistrationService;
    private final SecurityContextRepository securityContextRepository;
    private final CsrfTokenRepository csrfTokenRepository;

    public AuthenticationController(
            AuthenticationManager authenticationManager,
            AccountRegistrationService accountRegistrationService,
            SecurityContextRepository securityContextRepository,
            CsrfTokenRepository csrfTokenRepository) {
        this.authenticationManager = authenticationManager;
        this.accountRegistrationService = accountRegistrationService;
        this.securityContextRepository = securityContextRepository;
        this.csrfTokenRepository = csrfTokenRepository;
    }

    @GetMapping("/csrf")
    public CsrfResponse csrfToken(CsrfToken csrfToken) {
        return new CsrfResponse(csrfToken.getToken());
    }

    @GetMapping("/session")
    public SessionResponse session(Authentication authentication) {
        boolean authenticated = authentication != null
                && authentication.isAuthenticated()
                && !(authentication instanceof org.springframework.security.authentication.AnonymousAuthenticationToken);
        return new SessionResponse(authenticated, authenticated ? authentication.getName() : null);
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(
            @RequestBody LoginRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse servletResponse) {
        if (request == null) {
            return validationError(HttpStatus.BAD_REQUEST, "Username and password are required.");
        }
        if (request.username() == null || request.username().isBlank()
                || request.password() == null || request.password().isEmpty()) {
            return validationError(HttpStatus.BAD_REQUEST, "Username and password are required.");
        }

        Authentication authentication;
        try {
            authentication = authenticationManager.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(
                            request.username().trim(),
                            request.password()));
        } catch (AuthenticationException exception) {
            return validationError(HttpStatus.UNAUTHORIZED, "Username or password is incorrect.");
        }

        return establishSession(authentication, HttpStatus.OK, servletRequest, servletResponse);
    }

    @PostMapping("/register")
    public ResponseEntity<?> register(
            @RequestBody LoginRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse servletResponse) {
        if (request == null) {
            return validationError(HttpStatus.BAD_REQUEST, "Username and password are required.");
        }
        AccountPrincipal account;
        try {
            account = accountRegistrationService.register(request.username(), request.password());
        } catch (ResponseStatusException exception) {
            return validationError(
                    HttpStatus.valueOf(exception.getStatusCode().value()),
                    exception.getReason() == null ? "Registration could not be completed." : exception.getReason());
        }
        Authentication authentication = UsernamePasswordAuthenticationToken.authenticated(
                account,
                null,
                account.getAuthorities());
        return establishSession(authentication, HttpStatus.CREATED, servletRequest, servletResponse);
    }

    private ResponseEntity<SessionResponse> establishSession(
            Authentication authentication,
            HttpStatus status,
            HttpServletRequest servletRequest,
            HttpServletResponse servletResponse) {
        servletRequest.getSession(true);
        servletRequest.changeSessionId();
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        securityContextRepository.saveContext(context, servletRequest, servletResponse);
        csrfTokenRepository.saveToken(null, servletRequest, servletResponse);
        return ResponseEntity.status(status).body(new SessionResponse(true, authentication.getName()));
    }

    private ResponseEntity<ProblemDetail> validationError(HttpStatus status, String detail) {
        return ResponseEntity.status(status).body(ProblemDetail.forStatusAndDetail(status, detail));
    }

    public record LoginRequest(String username, String password) {
    }

    public record CsrfResponse(String token) {
    }

    public record SessionResponse(boolean authenticated, String username) {
    }
}
