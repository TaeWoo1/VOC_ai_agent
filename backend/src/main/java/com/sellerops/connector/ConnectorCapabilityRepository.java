package com.sellerops.connector;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ConnectorCapabilityRepository extends JpaRepository<ConnectorCapability, UUID> {

    List<ConnectorCapability> findByChannelCode(String channelCode);

    Optional<ConnectorCapability> findByChannelCodeAndConnectorClassAndDataType(
            String channelCode, String connectorClass, String dataType);
}
