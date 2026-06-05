import type * as k8s from "@kubernetes/client-node";
import { LABEL_ORGANIZATION } from "./namespace-manager";

export interface NetworkPolicyFactoryOptions {
    namespace: string;
    organizationId: string;
    ingressControllerNamespace: string;
}

export function buildNetworkPolicies(opts: NetworkPolicyFactoryOptions): k8s.V1NetworkPolicy[] {
    return [
        buildDefaultDenyPolicy(opts.namespace),
        buildSameOrgPolicy(opts.namespace, opts.organizationId),
        buildIngressControllerPolicy(opts.namespace, opts.ingressControllerNamespace),
        buildDnsEgressPolicy(opts.namespace),
        buildInternetEgressPolicy(opts.namespace),
    ];
}

function buildDefaultDenyPolicy(namespace: string): k8s.V1NetworkPolicy {
    return {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: {
            name: "default-deny",
            namespace,
        },
        spec: {
            podSelector: {},
            policyTypes: ["Ingress", "Egress"],
        },
    };
}

function buildSameOrgPolicy(namespace: string, organizationId: string): k8s.V1NetworkPolicy {
    const orgSelector: k8s.V1LabelSelector = {
        matchLabels: { [LABEL_ORGANIZATION]: organizationId },
    };

    return {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: {
            name: "allow-same-organization",
            namespace,
        },
        spec: {
            podSelector: {},
            policyTypes: ["Ingress", "Egress"],
            ingress: [{ _from: [{ namespaceSelector: orgSelector }] }],
            egress: [{ to: [{ namespaceSelector: orgSelector }] }],
        },
    };
}

function buildIngressControllerPolicy(namespace: string, ingressControllerNamespace: string): k8s.V1NetworkPolicy {
    // Only the shared ingress-nginx controller reaches preview pods now. The ALB
    // terminates TLS and forwards to ingress-nginx, which proxies in-cluster — so
    // the ALB subnets never hit these pods directly and need no allowance here.
    const from: k8s.V1NetworkPolicyPeer[] = [
        {
            namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": ingressControllerNamespace },
            },
        },
    ];

    return {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: {
            name: "allow-ingress-controller",
            namespace,
        },
        spec: {
            podSelector: {},
            policyTypes: ["Ingress"],
            ingress: [{ _from: from }],
        },
    };
}

function buildDnsEgressPolicy(namespace: string): k8s.V1NetworkPolicy {
    return {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: {
            name: "allow-dns-egress",
            namespace,
        },
        spec: {
            podSelector: {},
            policyTypes: ["Egress"],
            egress: [
                {
                    to: [
                        {
                            namespaceSelector: {
                                matchLabels: { "kubernetes.io/metadata.name": "kube-system" },
                            },
                        },
                    ],
                    ports: [
                        { protocol: "UDP", port: 53 },
                        { protocol: "TCP", port: 53 },
                    ],
                },
            ],
        },
    };
}

function buildInternetEgressPolicy(namespace: string): k8s.V1NetworkPolicy {
    return {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: {
            name: "allow-internet-egress",
            namespace,
        },
        spec: {
            podSelector: {},
            policyTypes: ["Egress"],
            egress: [
                {
                    to: [
                        {
                            ipBlock: {
                                cidr: "0.0.0.0/0",
                                except: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16"],
                            },
                        },
                    ],
                },
            ],
        },
    };
}
