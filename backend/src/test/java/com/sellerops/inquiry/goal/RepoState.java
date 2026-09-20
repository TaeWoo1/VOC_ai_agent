package com.sellerops.inquiry.goal;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * <b>Which commit a run is attributable to, and whether anything is uncommitted</b> (Inquiry v3.5).
 *
 * <p>One definition, read by the preflight when it writes a manifest and by the runner when it re-checks one. Two
 * copies of "what counts as a clean tree" is two answers to the question an approval is bound to, and the one that
 * matters is whichever happens to run at send time.
 */
public final class RepoState {

    private RepoState() {
    }

    public static String commit(Path repoRoot) {
        return git(repoRoot, "rev-parse", "HEAD");
    }

    /**
     * <b>Ignored build output aside, nothing uncommitted.</b> {@code node_modules} is excluded because it is present
     * in this worktree and is not source; everything else counts, including untracked files — a run whose harness is
     * half-written is not attributable to the commit it claims.
     */
    public static boolean clean(Path repoRoot) {
        return git(repoRoot, "status", "--porcelain").lines()
                .filter(line -> !line.isBlank())
                .noneMatch(line -> !line.contains("node_modules"));
    }

    private static String git(Path repoRoot, String... args) {
        List<String> command = new ArrayList<>(List.of("git"));
        command.addAll(List.of(args));
        try {
            Process process = new ProcessBuilder(command).directory(repoRoot.toFile())
                    .redirectErrorStream(true).start();
            String out = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            process.waitFor();
            return out.trim();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
